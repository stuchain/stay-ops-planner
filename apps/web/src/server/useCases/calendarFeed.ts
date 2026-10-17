import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createTranslator } from "next-intl";
import { z } from "zod";
import { addDays } from "@stay-ops/domain";
import { log } from "@stay-ops/shared";
import el from "../../../messages/el.json";
import en from "../../../messages/en.json";
import { prisma } from "@/lib/prisma";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import { decryptSecret, encryptSecret } from "@/modules/secrets/crypto";
import { buildIcs } from "@/server/calendarFeed/ics";
import { hosthubSource } from "@/server/sync/hosthubSource";
import { dbDateToIso, isoToDbDate, todayIso } from "@/server/time";
import { partyOf } from "./bookingSlice";
import { deleteSetting, readSetting, writeSetting } from "./settings";
import { syncHosthub } from "./syncHosthub";

/**
 * The phone calendar feed: a private address per user that calendar apps (iPhone, Google) subscribe to.
 * The token is the only key, so it is long and random; making a new one or switching it off stops the old
 * address at once. Stored in `settings` under `calendarFeed:<userId>`, encrypted (AES-256-GCM, like the Hosthub
 * key) so a copy of the database or a backup does not hand out the address; Settings can still show it again.
 */
const KEY_PREFIX = "calendarFeed:";

const blobSchema = z.object({ ciphertext: z.string(), iv: z.string(), tag: z.string() });
/** `token` is how addresses made before 17 Oct 2026 were kept; they keep working until replaced. */
const storedSchema = z.union([
  z.object({ enc: blobSchema, createdAt: z.string() }),
  z.object({ token: z.string().min(1), createdAt: z.string() }),
]);

/** The address path; the app adds its own origin. */
export function calendarFeedPath(token: string): string {
  return `/feed/${token}.ics`;
}

export type CalendarFeedInfo = { path: string; createdAt: string } | null;

async function stored(userId: string): Promise<{ token: string; createdAt: string } | null> {
  const parsed = storedSchema.safeParse(await readSetting(KEY_PREFIX + userId));
  if (!parsed.success) return null;
  if ("token" in parsed.data) return parsed.data;
  try {
    return { token: decryptSecret(parsed.data.enc), createdAt: parsed.data.createdAt };
  } catch {
    // The encryption key changed: the old address can't be checked, so it simply stops working.
    return null;
  }
}

export async function getCalendarFeed(userId: string): Promise<CalendarFeedInfo> {
  const row = await stored(userId);
  return row ? { path: calendarFeedPath(row.token), createdAt: row.createdAt } : null;
}

/** A new address for this user; any earlier one stops working. */
export async function createCalendarFeed(
  userId: string,
  now: Date = new Date(),
): Promise<NonNullable<CalendarFeedInfo>> {
  const token = `${userId}.${randomBytes(32).toString("base64url")}`;
  const createdAt = now.toISOString();
  await writeSetting(KEY_PREFIX + userId, { enc: encryptSecret(token), createdAt });
  return { path: calendarFeedPath(token), createdAt };
}

export async function removeCalendarFeed(userId: string): Promise<void> {
  await deleteSetting(KEY_PREFIX + userId);
}

const TOKEN_SHAPE = /^([a-z0-9]{1,64})\.([A-Za-z0-9_-]{43})$/;

function sameToken(a: string, b: string): boolean {
  // Hashing first gives equal lengths, so the comparison takes the same time whatever was sent.
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** The user a feed token belongs to, or null when it is unknown, replaced, switched off or the user left. */
export async function resolveCalendarFeedToken(token: string): Promise<{ userId: string; locale: "el" | "en" } | null> {
  const match = TOKEN_SHAPE.exec(token);
  const userId = match?.[1];
  if (!userId) return null;
  const row = await stored(userId);
  if (!row || !sameToken(row.token, token)) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, uiLocale: true } });
  if (!user?.isActive) return null;
  return { userId, locale: user.uiLocale === "en" ? "en" : "el" };
}

/** Past stays kept in the feed, and how far ahead it reaches. */
const DAYS_BACK = 30;
const DAYS_AHEAD = 550;
/** The reminder for an arrival: 09:00 the day before (15 hours before the arrival day starts). */
export const ARRIVAL_REMINDER_MINUTES = 15 * 60;
/** Asked of calendar apps; iPhone follows its own fetch setting and Google checks every few hours. */
const REFRESH_MINUTES = 60;

/** 2026-10-12 as 12/10/2026, the way dates are written in Greece. */
function dayMonthYear(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * The feed body: an arrival event (with the reminder) and a departure event for every booking that is not
 * cancelled, from a month back to about a year and a half ahead, in the user's language.
 */
export async function buildCalendarFeed(locale: "el" | "en", now: Date = new Date()): Promise<string> {
  const t = createTranslator({ locale, messages: locale === "en" ? en : el });
  const today = todayIso(now);
  const from = isoToDbDate(addDays(today, -DAYS_BACK));
  const to = isoToDbDate(addDays(today, DAYS_AHEAD));

  const rows = await prisma.booking.findMany({
    where: { status: { not: "cancelled" }, checkoutDate: { gte: from }, checkinDate: { lte: to } },
    orderBy: [{ checkinDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      channel: true,
      status: true,
      checkinDate: true,
      checkoutDate: true,
      nights: true,
      guestName: true,
      guestPhone: true,
      guestTotal: true,
      guestAdults: true,
      guestChildren: true,
      guestInfants: true,
      updatedAt: true,
      assignments: {
        orderBy: { startDate: "asc" },
        select: { updatedAt: true, room: { select: { displayName: true, code: true } } },
      },
    },
  });

  const events = rows.flatMap((row) => {
    // Arrival in the first apartment, departure from the last (they differ when the guest moved mid-stay).
    const nameOf = (piece: (typeof row.assignments)[number] | undefined) =>
      piece ? (piece.room.displayName ?? piece.room.code ?? "") : t("calendarFeed.noRoom");
    const roomName = nameOf(row.assignments[0]);
    const leaveRoomName = nameOf(row.assignments[row.assignments.length - 1]);
    const guest = row.guestName?.trim() || t("calendarFeed.noName");
    const party = partyOf(row);
    const checkin = dbDateToIso(row.checkinDate);
    const checkout = dbDateToIso(row.checkoutDate);
    const details = [
      `${roomName} · ${t(`channel.${row.channel}`)}`,
      [
        party ? t("common.people", { count: party.adults + party.children }) : null,
        t("common.nights", { count: row.nights }),
      ]
        .filter(Boolean)
        .join(" · "),
      t("calendarFeed.dates", { checkin: dayMonthYear(checkin), checkout: dayMonthYear(checkout) }),
      row.guestPhone ? t("calendarFeed.phone", { phone: row.guestPhone }) : null,
      row.status === "pending" ? t("calendarFeed.pending") : null,
    ]
      .filter(Boolean)
      .join("\n");
    // A move to another apartment changes the event text, so it counts as a change too.
    const lastModified = row.assignments.reduce((a, p) => (p.updatedAt > a ? p.updatedAt : a), row.updatedAt);
    return [
      {
        uid: `${row.id}-arrival@stay-ops-planner`,
        date: checkin,
        summary: t("calendarFeed.arrival", { guest, room: roomName }),
        description: details,
        lastModified,
        alarmMinutesBefore: ARRIVAL_REMINDER_MINUTES,
      },
      {
        uid: `${row.id}-departure@stay-ops-planner`,
        date: checkout,
        summary: t("calendarFeed.departure", { guest, room: leaveRoomName }),
        description: details,
        lastModified,
      },
    ];
  });

  return buildIcs({ name: t("calendarFeed.calendarName"), refreshMinutes: REFRESH_MINUTES, events, now });
}

/**
 * When a phone asks for the feed, first bring in what changed on Hosthub, so new bookings reach the phone
 * even when nobody opens the app. Same quick sync as opening the app: skipped when one ran in the last
 * few minutes. Never throws; the feed is served from what is stored either way.
 */
export async function refreshBeforeFeed(): Promise<void> {
  try {
    const token = await resolveHosthubApiToken();
    if (!token) return;
    await syncHosthub({ source: hosthubSource(token), trigger: "open" });
  } catch (e) {
    log("warn", "calendar_feed_sync_failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

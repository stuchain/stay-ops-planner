import { BookingStatus } from "@stay-ops/db";
import {
  addDays,
  firstStays,
  incomeFor,
  isoDate,
  statsPeriod,
  yearStats,
  type IsoDate,
  type StatsBooking,
  type YearStats,
} from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { dbDateToIso, todayIso } from "@/server/time";
import { listCalendarRooms } from "./calendarRange";
import { emailKey, nameKey, phoneKey } from "./previousStays";

export interface StatsApartment {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
}

/** One year's headline figures, for the years-side-by-side table. */
export interface StatsYearSummary {
  readonly year: number;
  readonly bookings: number;
  readonly nights: number;
  readonly incomeCents: number;
  readonly averageNightCents: number | null;
  readonly occupancyPercent: number | null;
  readonly cancellations: number;
}

export interface StatisticsData {
  readonly year: number;
  /** True when both years run from 1 January through `through` only. */
  readonly toDate: boolean;
  /** The last day counted (inclusive) in `year`; null for whole years. */
  readonly through: IsoDate | null;
  readonly apartments: readonly StatsApartment[];
  readonly thisYear: YearStats;
  readonly lastYear: YearStats;
  /** Every year with bookings, oldest first (whole years, the current one up to today's bookings). */
  readonly years: readonly StatsYearSummary[];
  /** Share of this year's stays with a booked-on day (lead time is only measured on those). */
  readonly leadTimeKnown: number;
}

/** Hosthub's `created` (Unix seconds or an ISO time) as a day in UTC; null when missing. */
export function bookedOnFromRaw(created: unknown): IsoDate | null {
  if (typeof created === "number" && Number.isFinite(created) && created > 0) {
    return isoDate(new Date(created * 1000).toISOString().slice(0, 10));
  }
  if (typeof created === "string" && created.trim() !== "") {
    const asNumber = Number(created);
    if (Number.isFinite(asNumber) && asNumber > 0) return bookedOnFromRaw(asNumber);
    const t = Date.parse(created);
    if (!Number.isNaN(t)) return isoDate(new Date(t).toISOString().slice(0, 10));
  }
  return null;
}

/** Phone first, then e-mail, then full name; prefixed so a phone never equals a name. */
export function guestKey(phone: string | null, email: string | null, name: string | null): string | null {
  const p = phoneKey(phone);
  if (p !== null) return `p:${p}`;
  const e = emailKey(email);
  if (e !== null) return `e:${e}`;
  const n = nameKey(name);
  return n === null ? null : `n:${n}`;
}

function kindOf(status: BookingStatus): StatsBooking["kind"] {
  if (status === BookingStatus.cancelled) return "cancelled";
  if (status === BookingStatus.pending) return "pending";
  return "stay";
}

/** All bookings ever, as the statistics read them. */
export async function loadStatsBookings(db: typeof prisma = prisma): Promise<StatsBooking[]> {
  const [rows, created] = await Promise.all([
    db.booking.findMany({
      select: {
        id: true,
        channel: true,
        status: true,
        checkinDate: true,
        checkoutDate: true,
        totalValueCents: true,
        totalAmountCents: true,
        payoutAmountCents: true,
        cleaningFeeCents: true,
        currency: true,
        guestName: true,
        guestEmail: true,
        guestPhone: true,
        guestAdults: true,
        guestChildren: true,
        guestInfants: true,
        assignments: { orderBy: { startDate: "asc" }, select: { roomId: true, startDate: true, endDate: true } },
      },
    }),
    db.$queryRaw<{ id: string; created: unknown }[]>`
      SELECT id, hosthub_calendar_event_raw -> 'created' AS created
      FROM bookings
      WHERE hosthub_calendar_event_raw ? 'created'`,
  ]);
  const bookedOn = new Map(created.map((r) => [r.id, bookedOnFromRaw(r.created)]));
  return rows.map((b) => {
    const income = incomeFor({
      channel: b.channel,
      status: b.status,
      totalValueCents: b.totalValueCents,
      bookingValueCents: b.totalAmountCents,
      payoutCents: b.payoutAmountCents,
      cleaningFeeCents: b.cleaningFeeCents,
      currency: b.currency,
    });
    const counts = income.counts && income.kind !== "pending";
    return {
      channel: b.channel,
      kind: kindOf(b.status),
      checkin: dbDateToIso(b.checkinDate),
      checkout: dbDateToIso(b.checkoutDate),
      roomId: b.assignments[0]?.roomId ?? null,
      ...(b.assignments.length > 1
        ? {
            pieces: b.assignments.map((a) => ({
              roomId: a.roomId,
              start: dbDateToIso(a.startDate),
              end: dbDateToIso(a.endDate),
            })),
          }
        : {}),
      incomeCents: counts ? income.grossCents : 0,
      payoutCents: counts ? income.payoutCents : 0,
      feeCents: counts ? income.channelFeeCents : null,
      bookedOn: bookedOn.get(b.id) ?? null,
      adults: b.guestAdults,
      children: b.guestChildren,
      infants: b.guestInfants,
      guestKey: guestKey(b.guestPhone, b.guestEmail, b.guestName),
    };
  });
}

/**
 * Everything the statistics page shows for a year against the year before. With `toDate`, both
 * years run from 1 January through today's month and day, so a year still under way compares
 * fairly. Occupancy is measured on the apartments shown (active ones, plus any that had stays).
 */
export async function buildStatistics(
  input: { year: number; toDate: boolean; today?: IsoDate },
  db: typeof prisma = prisma,
): Promise<StatisticsData> {
  const today = input.today ?? todayIso();
  const bookings = await loadStatsBookings(db);
  const rooms = await listCalendarRooms();
  const first = firstStays(bookings);
  const through = input.toDate ? { month: Number(today.slice(5, 7)), day: Number(today.slice(8, 10)) } : null;
  const periodNow = statsPeriod(input.year, through);
  const periodBefore = statsPeriod(input.year - 1, through);

  const used = new Set(bookings.filter((b) => b.kind === "stay" && b.roomId !== null).map((b) => b.roomId!));
  const shown = rooms.filter((r) => r.isActive || used.has(r.id));
  const ids = shown.map((r) => r.id);

  const thisYear = yearStats(bookings, periodNow, ids, first);
  const lastYear = yearStats(bookings, periodBefore, ids, first);

  const checkinYears = bookings.filter((b) => b.kind !== "pending").map((b) => Number(b.checkin.slice(0, 4)));
  const firstYear = Math.min(input.year - 1, ...checkinYears);
  const lastYearShown = Math.max(input.year, Number(today.slice(0, 4)));
  const years: StatsYearSummary[] = [];
  for (let y = firstYear; y <= lastYearShown; y += 1) {
    const s = yearStats(bookings, statsPeriod(y, null), ids, first);
    if (s.bookings === 0 && s.cancellations === 0 && y !== input.year) continue;
    years.push({
      year: y,
      bookings: s.bookings,
      nights: s.nights,
      incomeCents: s.incomeCents,
      averageNightCents: s.averageNightCents,
      occupancyPercent: s.occupancyPercent,
      cancellations: s.cancellations,
    });
  }

  const staysNow = bookings.filter((b) => b.kind === "stay" && b.checkin >= periodNow.from && b.checkin < periodNow.to);
  const withLead = staysNow.filter((b) => b.bookedOn !== null).length;

  return {
    year: input.year,
    toDate: input.toDate,
    through: input.toDate ? addDays(periodNow.to, -1) : null,
    apartments: shown.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    thisYear,
    lastYear,
    years,
    leadTimeKnown: staysNow.length > 0 ? Math.round((withLead * 100) / staysNow.length) : 0,
  };
}

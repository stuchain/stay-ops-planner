/**
 * The phone calendar feed against a real database: the private address, and what the feed holds.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import {
  buildCalendarFeed,
  createCalendarFeed,
  getCalendarFeed,
  removeCalendarFeed,
  resolveCalendarFeedToken,
} from "@/server/useCases/calendarFeed";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

const prisma = new PrismaClient();
const NOW = new Date("2030-06-10T05:00:00Z");
let seq = 0;

async function reset() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "assignments", "cleaning_tasks", "bookings", "rooms", "users", "settings", "integration_secrets"
    RESTART IDENTITY CASCADE;
  `);
}

async function user(isActive = true) {
  seq += 1;
  return prisma.user.create({ data: { email: `feed-${seq}@example.com`, passwordHash: "x", isActive } });
}

async function booking(guestName: string, checkin: string, checkout: string, status: BookingStatus, roomId?: string) {
  seq += 1;
  const b = await prisma.booking.create({
    data: {
      channel: Channel.airbnb,
      externalBookingId: `feed-${seq}`,
      status,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 3,
      guestName,
      guestAdults: 2,
      guestPhone: "+30 690 000 0000",
    },
  });
  if (roomId) {
    await prisma.assignment.create({
      data: { bookingId: b.id, roomId, startDate: b.checkinDate, endDate: b.checkoutDate },
    });
  }
  return b;
}

function tokenOf(path: string): string {
  return path.replace(/^\/feed\//, "").replace(/\.ics$/, "");
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe("calendar feed address", () => {
  it("is made, found again, replaced and switched off", async () => {
    const u = await user();
    expect(await getCalendarFeed(u.id)).toBeNull();

    const first = await createCalendarFeed(u.id);
    expect(await getCalendarFeed(u.id)).toEqual(first);
    expect(await resolveCalendarFeedToken(tokenOf(first.path))).toEqual({ userId: u.id, locale: "el" });

    const second = await createCalendarFeed(u.id);
    expect(second.path).not.toBe(first.path);
    expect(await resolveCalendarFeedToken(tokenOf(first.path))).toBeNull();
    expect(await resolveCalendarFeedToken(tokenOf(second.path))).not.toBeNull();

    await removeCalendarFeed(u.id);
    expect(await resolveCalendarFeedToken(tokenOf(second.path))).toBeNull();
  });

  it("keeps the address encrypted in the database, and still accepts one stored before that", async () => {
    const u = await user();
    const feed = await createCalendarFeed(u.id);
    const row = await prisma.setting.findUniqueOrThrow({ where: { key: `calendarFeed:${u.id}` } });
    expect(JSON.stringify(row)).not.toContain(tokenOf(feed.path).split(".")[1]);

    const legacy = `${u.id}.${"a".repeat(43)}`;
    await prisma.setting.update({
      where: { key: `calendarFeed:${u.id}` },
      data: { value: { token: legacy, createdAt: feed.createdAt } },
    });
    expect(await resolveCalendarFeedToken(legacy)).toEqual({ userId: u.id, locale: "el" });
  });

  it("rejects made-up, damaged and another user's tokens, and users who left", async () => {
    const a = await user();
    const b = await user();
    const feedA = tokenOf((await createCalendarFeed(a.id)).path);
    const secretA = feedA.split(".")[1]!;
    expect(await resolveCalendarFeedToken("nonsense")).toBeNull();
    expect(await resolveCalendarFeedToken(`${feedA.slice(0, -1)}x`)).toBeNull();
    expect(await resolveCalendarFeedToken(`${b.id}.${secretA}`)).toBeNull();

    await prisma.user.update({ where: { id: a.id }, data: { isActive: false } });
    expect(await resolveCalendarFeedToken(feedA)).toBeNull();
  });
});

describe("calendar feed contents", () => {
  it("lists arrivals with a reminder and departures, without cancelled or old stays", async () => {
    const room = await prisma.room.create({ data: { code: "R1", displayName: "Onar" } });
    await booking("Maria", "2030-06-20", "2030-06-23", BookingStatus.confirmed, room.id);
    await booking("Nikos", "2030-07-01", "2030-07-04", BookingStatus.pending);
    await booking("Cancelled Guest", "2030-06-25", "2030-06-28", BookingStatus.cancelled);
    await booking("Long Ago", "2029-01-01", "2029-01-04", BookingStatus.confirmed);

    // Long lines are folded; unfold them to read the text.
    const ics = (await buildCalendarFeed("el", NOW)).replace(/\r\n /g, "");
    expect(ics).toContain("SUMMARY:Άφιξη: Maria · Onar");
    expect(ics).toContain("SUMMARY:Αναχώρηση: Maria · Onar");
    expect(ics).toContain("SUMMARY:Άφιξη: Nikos · χωρίς διαμέρισμα");
    expect(ics).toContain("Περιμένει επιβεβαίωση.");
    expect(ics).toContain("Από 20/06/2030 έως 23/06/2030");
    expect(ics).not.toContain("Cancelled Guest");
    expect(ics).not.toContain("Long Ago");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(ics.match(/TRIGGER:-PT15H/g)).toHaveLength(2);

    const en = await buildCalendarFeed("en", NOW);
    expect(en).toContain("SUMMARY:Arrival: Maria · Onar");
    expect(en).toContain("X-WR-CALNAME:Bookings");
  });

  it("is served at /feed/<token>.ics only for a known token", async () => {
    const { GET } = await import("@/app/feed/[file]/route");
    const u = await user();
    await booking("Maria", "2030-06-20", "2030-06-23", BookingStatus.confirmed);
    const { path } = await createCalendarFeed(u.id);
    const file = path.replace(/^\/feed\//, "");

    const ok = await GET(new NextRequest(`http://localhost${path}`), { params: Promise.resolve({ file }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(await ok.text()).toContain("BEGIN:VCALENDAR");

    const missing = await GET(new NextRequest("http://localhost/feed/x.ics"), {
      params: Promise.resolve({ file: "x.ics" }),
    });
    expect(missing.status).toBe(404);
  });
});

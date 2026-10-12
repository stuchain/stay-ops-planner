/**
 * Statistics page: a year against the one before, and review pages, against a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient, ReviewPlatform } from "@stay-ops/db";
import { isoDate } from "@stay-ops/domain";

const prisma = new PrismaClient();
let seq = 0;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "ledger_entries", "assignments", "cleaning_tasks", "bookings",
      "source_listings", "rooms", "users", "tax_rules", "excel_rental_config", "review_snapshots", "review_sources"
    RESTART IDENTITY CASCADE;
  `);
}

async function room(name: string, sort: number) {
  return prisma.room.create({ data: { code: name.toLowerCase(), displayName: name, calendarSortIndex: sort } });
}

async function booking(
  roomId: string | null,
  checkin: string,
  checkout: string,
  opts: {
    status?: BookingStatus;
    channel?: Channel;
    total?: number;
    payout?: number | null;
    created?: number;
    phone?: string;
    adults?: number;
  } = {},
) {
  seq += 1;
  const from = new Date(`${checkin}T00:00:00Z`);
  const to = new Date(`${checkout}T00:00:00Z`);
  const b = await prisma.booking.create({
    data: {
      channel: opts.channel ?? Channel.airbnb,
      externalBookingId: `stats-${seq}`,
      status: opts.status ?? BookingStatus.confirmed,
      checkinDate: from,
      checkoutDate: to,
      nights: Math.round((to.getTime() - from.getTime()) / 86_400_000),
      totalValueCents: opts.total ?? 30_000,
      payoutAmountCents: opts.payout === undefined ? 25_000 : opts.payout,
      currency: "EUR",
      guestPhone: opts.phone ?? null,
      guestAdults: opts.adults ?? null,
      ...(opts.created ? { hosthubCalendarEventRaw: { id: `evt-${seq}`, created: opts.created } } : {}),
    },
  });
  if (roomId) await prisma.assignment.create({ data: { bookingId: b.id, roomId, startDate: from, endDate: to } });
  return b;
}

describe("statistics", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(truncate);

  const build = async (year: number, toDate: boolean, today = "2030-12-31") => {
    const { buildStatistics } = await import("@/server/useCases/statistics");
    return buildStatistics({ year, toDate, today: isoDate(today) }, prisma);
  };

  it("compares a year with the one before, by channel and apartment", async () => {
    const onar = await room("Onar", 1);
    const cosmos = await room("Cosmos", 2);
    const created = Date.UTC(2030, 5, 1) / 1000; // 1 June 2030
    await booking(onar.id, "2030-07-01", "2030-07-04", { created, phone: "+30 699 000 0001", adults: 2 });
    await booking(cosmos.id, "2030-08-01", "2030-08-03", { channel: Channel.booking, total: 20_000, payout: 17_000 });
    await booking(null, "2030-09-01", "2030-09-02", { channel: Channel.direct, total: 10_000, payout: null });
    await booking(onar.id, "2030-10-01", "2030-10-03", { status: BookingStatus.cancelled, payout: 5_000 });
    await booking(onar.id, "2030-11-01", "2030-11-03", { status: BookingStatus.pending });
    await booking(onar.id, "2029-07-01", "2029-07-03", { phone: "6990000001" });

    const s = await build(2030, false);
    expect(s.through).toBeNull();
    expect(s.apartments.map((a) => a.name)).toEqual(["Onar", "Cosmos"]);
    expect(s.thisYear).toMatchObject({
      bookings: 3,
      nights: 6,
      placedNights: 5,
      availableNights: 730,
      incomeCents: 65_000,
      cancellations: 1,
      cancelledIncomeCents: 5_000,
      pending: 1,
      returningStays: 1,
      averageLeadDays: 30,
    });
    expect(s.thisYear.byChannel.map((c) => [c.channel, c.bookings, c.incomeCents])).toEqual([
      ["airbnb", 1, 35_000],
      ["booking", 1, 20_000],
      ["direct", 1, 10_000],
    ]);
    expect(s.thisYear.byRoom.map((r) => r.nights)).toEqual([3, 2]);
    expect(s.lastYear).toMatchObject({ bookings: 1, nights: 2, incomeCents: 30_000 });
    expect(s.years.map((y) => [y.year, y.bookings])).toEqual([
      [2029, 1],
      [2030, 3],
    ]);
    expect(s.leadTimeKnown).toBe(33);
  });

  it("cuts both years at today's day when asked", async () => {
    const onar = await room("Onar", 1);
    await booking(onar.id, "2030-03-01", "2030-03-03");
    await booking(onar.id, "2030-09-01", "2030-09-03");
    await booking(onar.id, "2029-03-01", "2029-03-03");
    await booking(onar.id, "2029-09-01", "2029-09-03");

    const s = await build(2030, true, "2030-06-30");
    expect(s.through).toBe("2030-06-30");
    expect(s.thisYear.bookings).toBe(1);
    expect(s.lastYear.bookings).toBe(1);
    expect(s.lastYear.period).toEqual({ from: "2029-01-01", to: "2029-07-01" });
  });

  it("reads Hosthub's booked-on time in seconds or as text", async () => {
    const { bookedOnFromRaw, guestKey } = await import("@/server/useCases/statistics");
    expect(bookedOnFromRaw(1_900_000_000)).toBe("2030-03-17");
    expect(bookedOnFromRaw("1900000000")).toBe("2030-03-17");
    expect(bookedOnFromRaw("2030-03-17T10:00:00+02:00")).toBe("2030-03-17");
    expect(bookedOnFromRaw("soon")).toBeNull();
    expect(bookedOnFromRaw(null)).toBeNull();
    expect(guestKey("+30 699 000 0001", null, null)).toBe("p:6990000001");
    expect(guestKey(null, " A@B.gr ", null)).toBe("e:a@b.gr");
    expect(guestKey(null, null, "Μαρία Παπά")).toBe("n:μαρια παπα");
    expect(guestKey(null, null, "Maria")).toBeNull();
  });
});

describe("reviews", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  beforeEach(truncate);

  const reviews = () => import("@/server/useCases/reviews");

  it("adds pages only on the platform's own site and keeps a score per day", async () => {
    const r = await reviews();
    await expect(
      r.addReviewSource(
        { platform: ReviewPlatform.airbnb, url: "https://evil.example/rooms/1", label: null, roomId: null },
        prisma,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      r.addReviewSource({ platform: ReviewPlatform.booking, url: "not a link", label: null, roomId: null }, prisma),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      r.addReviewSource(
        { platform: ReviewPlatform.booking, url: "https://www.booking.com/x", label: null, roomId: "nope" },
        prisma,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { id } = await r.addReviewSource(
      { platform: ReviewPlatform.airbnb, url: "https://www.airbnb.gr/rooms/123", label: "Onar", roomId: null },
      prisma,
    );

    await r.recordReviewScore({ sourceId: id, rating: 4.8, count: 100, today: isoDate("2029-06-01") }, prisma);
    await r.recordReviewScore({ sourceId: id, rating: 4.85, count: 110, today: isoDate("2029-12-20") }, prisma);
    await r.recordReviewScore({ sourceId: id, rating: 4.9, count: 120, today: isoDate("2030-06-02") }, prisma);
    await r.recordReviewScore({ sourceId: id, rating: 4.92, count: 125, today: isoDate("2030-06-02") }, prisma);
    await expect(r.recordReviewScore({ sourceId: id, rating: 6, count: null }, prisma)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(r.recordReviewScore({ sourceId: id, rating: null, count: null }, prisma)).rejects.toMatchObject({
      code: "VALIDATION",
    });

    const data = await r.listReviews(2030, isoDate("2030-06-02"), prisma);
    expect(data.sources).toHaveLength(1);
    expect(data.sources[0]).toMatchObject({
      label: "Onar",
      scale: 5,
      latest: { takenOn: "2030-06-02", rating: 4.92, count: 125, origin: "manual" },
      yearAgo: { takenOn: "2029-06-01", rating: 4.8, count: 100 },
      yearStart: { takenOn: "2029-12-20", count: 110 },
      latestReviews: [],
    });

    await r.removeReviewSource(id, prisma);
    await expect(r.removeReviewSource(id, prisma)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.reviewSnapshot.count()).toBe(0);
  });

  it("reads Google once a day with the key, and does nothing without it", async () => {
    const r = await reviews();
    const { id } = await r.addReviewSource(
      {
        platform: ReviewPlatform.google,
        url: "https://www.google.com/maps/place/Heaven's+Door/@37.1,25.2,17z",
        label: null,
        roomId: null,
      },
      prisma,
    );
    expect(await r.refreshGoogleReviews({ key: null }, prisma)).toEqual({ status: "no_key", updated: 0, failed: 0 });

    const calls: string[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).endsWith("places:searchText")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ textQuery: "Heaven's Door" });
        return new Response(JSON.stringify({ places: [{ id: "place-1" }] }));
      }
      return new Response(
        JSON.stringify({
          id: "place-1",
          rating: 4.7,
          userRatingCount: 88,
          reviews: [{ rating: 5, originalText: { text: "Υπέροχα" }, authorAttribution: { displayName: "Ann" } }],
        }),
      );
    }) as typeof fetch;

    const today = isoDate("2030-06-02");
    expect(await r.refreshGoogleReviews({ key: "k", fetcher, today }, prisma)).toEqual({
      status: "done",
      updated: 1,
      failed: 0,
    });
    expect(await r.refreshGoogleReviews({ key: "k", fetcher, today }, prisma)).toMatchObject({ updated: 0 });
    expect(calls).toHaveLength(2);
    expect((await prisma.reviewSource.findUnique({ where: { id } }))?.googlePlaceId).toBe("place-1");

    const data = await r.listReviews(2030, today, prisma);
    expect(data.sources[0]).toMatchObject({
      latest: { rating: 4.7, count: 88, origin: "google" },
      latestReviews: [{ author: "Ann", rating: 5, text: "Υπέροχα", publishedAt: null }],
    });

    const failing = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    expect(await r.refreshGoogleReviews({ key: "k", fetcher: failing, today: isoDate("2030-06-03") }, prisma)).toEqual({
      status: "done",
      updated: 0,
      failed: 1,
    });
  });
});

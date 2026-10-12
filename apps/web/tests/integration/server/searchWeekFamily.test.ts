/**
 * Booking search, the weekly summary and family (read-only) accounts against a real database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import type { IsoDate } from "@stay-ops/domain";
import { createCaller } from "@/server/api/root";
import { searchBookings } from "@/server/useCases/bookingSearch";
import { getWeekSummary } from "@/server/useCases/weekSummary";

const prisma = new PrismaClient();
const TAG = `swf-${Date.now()}`;
let seq = 0;
const ids: Record<string, string> = {};

function as(role: "viewer" | "operator" | "admin", userId: string) {
  return createCaller({ headers: new Headers(), user: { userId, role, sessionExpiresAt: new Date(Date.now() + 1e6) } });
}

async function booking(
  guestName: string,
  checkin: string,
  checkout: string,
  extra: { phone?: string; email?: string; status?: BookingStatus; roomId?: string } = {},
) {
  seq += 1;
  const created = await prisma.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `${TAG}-${seq}`,
      status: extra.status ?? BookingStatus.confirmed,
      checkinDate: new Date(`${checkin}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 0,
      guestName,
      guestPhone: extra.phone ?? null,
      guestEmail: extra.email ?? null,
      guestAdults: 2,
      totalAmountCents: 30000,
      totalValueCents: 30000,
    },
  });
  if (extra.roomId) {
    await prisma.assignment.create({
      data: {
        bookingId: created.id,
        roomId: extra.roomId,
        startDate: created.checkinDate,
        endDate: created.checkoutDate,
      },
    });
  }
  return created;
}

beforeAll(async () => {
  for (const role of ["admin", "operator"] as const) {
    const u = await prisma.user.create({ data: { email: `${TAG}-${role}@example.com`, passwordHash: "x", role } });
    ids[role] = u.id;
  }
  const room = await prisma.room.create({
    data: { code: `${TAG}-r`, displayName: "Ζέφυρος", color: "#0F766E", maxGuests: 4, isActive: true },
  });
  ids.room = room.id;
  ids.past = (
    await booking("Ζωή Ξανθοπούλου", "2031-03-02", "2031-03-05", { phone: "+30 691 234 5678", roomId: room.id })
  ).id;
  ids.future = (await booking("ΞΑΝΘΟΣ Ζωγράφος", "2031-03-04", "2031-03-09", { email: "Xanthos@Example.com" })).id;
  ids.cancelled = (
    await booking("Ζωή Ξανθοπούλου", "2031-04-01", "2031-04-03", { status: BookingStatus.cancelled })
  ).id;
});

afterAll(async () => {
  await prisma.assignment.deleteMany({ where: { roomId: ids.room! } });
  await prisma.cleaningTask.deleteMany({ where: { roomId: ids.room! } });
  await prisma.booking.deleteMany({ where: { externalBookingId: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { id: ids.room! } });
  await prisma.auditEvent.deleteMany({ where: { user: { email: { startsWith: TAG } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.$disconnect();
});

const found = (out: { results: { id: string }[] }) => out.results.map((r) => r.id);

describe("searchBookings", () => {
  it("finds names without accents or case, and leaves cancelled ones out unless asked", async () => {
    expect(found(await searchBookings({ text: "ξανθοπουλου" }))).toEqual([ids.past]);
    expect(found(await searchBookings({ text: "ΖΩΉ ξανθ", includeCancelled: true }))).toEqual([
      ids.cancelled,
      ids.past,
    ]);
    expect(found(await searchBookings({ text: "ξανθοσ" }))).toEqual([ids.future]);
  });

  it("finds phone numbers however they are typed, and e-mails", async () => {
    expect(found(await searchBookings({ text: "6912345678" }))).toEqual([ids.past]);
    expect(found(await searchBookings({ text: "691 234" }))).toEqual([ids.past]);
    expect(found(await searchBookings({ text: "xanthos@example" }))).toEqual([ids.future]);
  });

  it("finds stays that include a night in the dates", async () => {
    const both = found(await searchBookings({ from: "2031-03-04" as IsoDate }));
    expect(both).toEqual(expect.arrayContaining([ids.past, ids.future]));
    // 5 March is the day the first guest leaves: no night there.
    expect(found(await searchBookings({ from: "2031-03-05" as IsoDate, text: "ξανθ" }))).toEqual([ids.future]);
    expect(found(await searchBookings({ text: "" }))).toEqual([]);
  });
});

describe("getWeekSummary", () => {
  it("lists each day's arrivals and departures from the Monday of the week", async () => {
    const week = await getWeekSummary("2031-03-05" as IsoDate, new Date("2031-03-05T10:00:00Z"));
    expect(week.from).toBe("2031-03-03");
    expect(week.days).toHaveLength(7);
    const day = (d: string) => week.days.find((x) => x.date === d)!;
    expect(day("2031-03-04").arrivals.map((s) => s.id)).toEqual([ids.future]);
    expect(day("2031-03-05").departures.map((s) => s.id)).toEqual([ids.past]);
    expect(day("2031-03-05").departures[0]!.room?.name).toBe("Ζέφυρος");
    // The arrival on Sunday 2 March belongs to the week before.
    expect(week.days.flatMap((d) => d.arrivals).map((s) => s.id)).not.toContain(ids.past);
  });
});

describe("family accounts", () => {
  it("an admin adds a read-only member, who sees bookings but no money and cannot change anything", async () => {
    const admin = as("admin", ids.admin!);
    const member = await admin.admin.family.add({
      email: `${TAG}-Mom@Example.com`,
      password: "family-pass-1",
      locale: "el",
    });
    expect(member.email).toBe(`${TAG}-mom@example.com`);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.role).toBe("viewer");
    expect((await admin.admin.family.list()).members.map((m) => m.id)).toContain(member.id);
    await expect(
      admin.admin.family.add({ email: `${TAG}-mom@example.com`, password: "family-pass-1", locale: "el" }),
    ).rejects.toMatchObject({ message: "EMAIL_TAKEN" });

    const viewer = as("viewer", member.id);
    expect(found(await viewer.booking.search({ text: "ξανθοπουλου" }))).toEqual([ids.past]);
    expect((await viewer.booking.details({ bookingId: ids.past! })).price).toBeNull();
    expect((await as("operator", ids.operator!).booking.details({ bookingId: ids.past! })).price).not.toBeNull();
    await expect(viewer.money.occupancy({ year: 2031 })).rejects.toMatchObject({ message: "FORBIDDEN" });
    await expect(
      viewer.booking.move({ bookingId: ids.future!, roomId: ids.room!, expectedVersion: 0 }),
    ).rejects.toMatchObject({ message: "FORBIDDEN" });
    await expect(viewer.admin.family.list()).rejects.toMatchObject({ message: "FORBIDDEN" });

    await admin.admin.family.setActive({ userId: member.id, active: false });
    const off = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(off.isActive).toBe(false);
    expect(off.sessionVersion).toBe(row.sessionVersion + 1);
  });

  it("only changes read-only accounts", async () => {
    await expect(
      as("admin", ids.admin!).admin.family.setActive({ userId: ids.operator!, active: false }),
    ).rejects.toMatchObject({ message: "NOT_FOUND" });
    await expect(
      as("operator", ids.operator!).admin.family.add({
        email: `${TAG}-x@example.com`,
        password: "family-pass-1",
        locale: "el",
      }),
    ).rejects.toMatchObject({ message: "FORBIDDEN" });
  });
});

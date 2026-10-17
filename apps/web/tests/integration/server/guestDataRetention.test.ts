/**
 * Old guests' contact and identity details are blanked 24 months after checkout; the rest of the booking stays.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { runGuestDataRetention, stripPersonalKeys } from "@/server/useCases/guestDataRetention";

const prisma = new PrismaClient();
const NOW = new Date("2030-06-10T05:00:00Z");
let seq = 0;

async function booking(checkout: string) {
  seq += 1;
  return prisma.booking.create({
    data: {
      channel: Channel.booking,
      externalBookingId: `ret-${seq}`,
      status: BookingStatus.confirmed,
      checkinDate: new Date(`${checkout}T00:00:00Z`),
      checkoutDate: new Date(`${checkout}T00:00:00Z`),
      nights: 2,
      guestName: "Maria P",
      guestPhone: "+30 690 000 0000",
      guestEmail: "maria@example.com",
      guestNote: "pays on arrival",
      notes: "call +30 690 000 0000",
      totalValueCents: 25_000,
      hosthubNotesRaw: [{ text: "phone me" }],
      rawPayload: {
        total_value: 250,
        guest_identification_number: "AB123456",
        guest: { name: "Maria P", phone: "+30 690 000 0000", email: "maria@example.com", passport: "AB123456" },
      },
    },
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "bookings", "audit_events", "sync_runs" RESTART IDENTITY CASCADE;`);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("guest data retention", () => {
  it("strips contact and identity keys at any depth", () => {
    expect(
      stripPersonalKeys({ a: 1, guest: { name: "M", mobile_phone: "1", e_mail: "x" }, list: [{ address: "y", n: 2 }] }),
    ).toEqual({
      a: 1,
      guest: { name: "M" },
      list: [{ n: 2 }],
    });
  });

  it("blanks bookings that left more than 24 months ago and keeps newer ones", async () => {
    const old = await booking("2028-05-01");
    const recent = await booking("2028-07-01");
    expect(await runGuestDataRetention(NOW)).toEqual({ bookings: 1, auditEvents: 0, syncRuns: 0 });

    const o = await prisma.booking.findUniqueOrThrow({ where: { id: old.id } });
    expect(o.guestPhone).toBeNull();
    expect(o.guestEmail).toBeNull();
    expect(o.notes).toBeNull();
    expect(o.hosthubNotesRaw).toBeNull();
    expect(o.rawPayload).toEqual({ total_value: 250, guest: { name: "Maria P" } });
    expect(o.guestName).toBe("Maria P");
    expect(o.guestNote).toBe("pays on arrival");
    expect(o.totalValueCents).toBe(25_000);

    const r = await prisma.booking.findUniqueOrThrow({ where: { id: recent.id } });
    expect(r.guestPhone).toBe("+30 690 000 0000");

    // Nothing left to do the next morning.
    expect(await runGuestDataRetention(NOW)).toEqual({ bookings: 0, auditEvents: 0, syncRuns: 0 });
  });

  it("deletes change history older than 24 months", async () => {
    await prisma.auditEvent.create({
      data: {
        entityType: "booking",
        entityId: "x",
        action: "booking.edit",
        createdAt: new Date("2028-01-01T00:00:00Z"),
      },
    });
    await prisma.auditEvent.create({
      data: {
        entityType: "booking",
        entityId: "y",
        action: "booking.edit",
        createdAt: new Date("2029-01-01T00:00:00Z"),
      },
    });
    const res = await runGuestDataRetention(NOW);
    expect(res).toMatchObject({ auditEvents: 1 });
    expect(await prisma.auditEvent.count()).toBe(1);
  });
});

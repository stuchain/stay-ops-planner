import { expect, test } from "@playwright/test";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { applyCancellationSideEffects } from "@stay-ops/sync";
import { applyHosthubBooking } from "../../src/server/sync/applyBooking";
import { CALENDAR_HEADING, TODAY_HEADING, e2eCredentials, loginAsStaff, reseedE2EFixtures } from "./helpers";

test.describe("ops gate smoke @smoke", () => {
  test.beforeEach(async () => {
    await reseedE2EFixtures();
  });

  test("@smoke end-to-end operator loop", async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");

    await test.step("sync reservation upsert (pipeline)", async () => {
      const prisma = new PrismaClient();
      try {
        const rid = `e2e-smoke-ingest-${Date.now()}`;
        const dto = {
          reservationId: rid,
          listingId: "e2e-smoke-listing",
          status: "confirmed" as const,
          checkIn: "2026-08-01",
          checkOut: "2026-08-05",
          listingChannel: "airbnb",
        };
        await prisma.$transaction((tx) => applyHosthubBooking(tx, { dto, raw: dto }));
        const row = await prisma.booking.findFirst({
          where: { channel: Channel.airbnb, externalBookingId: rid },
        });
        expect(row).not.toBeNull();
        expect(row?.status).toBe(BookingStatus.confirmed);
      } finally {
        await prisma.$disconnect();
      }
    });

    await test.step("cancellation side effects", async () => {
      const prisma = new PrismaClient();
      try {
        const room = await prisma.room.findFirst({ where: { code: "E2E-A" } });
        expect(room).not.toBeNull();
        const ext = `e2e-smoke-cancel-${Date.now()}`;
        await prisma.$transaction(async (tx) => {
          const b = await tx.booking.create({
            data: {
              channel: Channel.direct,
              externalBookingId: ext,
              status: BookingStatus.confirmed,
              checkinDate: new Date("2026-09-01T00:00:00.000Z"),
              checkoutDate: new Date("2026-09-05T00:00:00.000Z"),
              nights: 4,
              rawPayload: {},
            },
          });
          await tx.assignment.create({
            data: {
              bookingId: b.id,
              roomId: room!.id,
              startDate: b.checkinDate,
              endDate: b.checkoutDate,
              version: 0,
            },
          });
          await tx.cleaningTask.create({
            data: {
              bookingId: b.id,
              roomId: room!.id,
              status: "todo",
              taskType: "turnover",
              sourceEventId: `e2e-smoke-cancel-clean-${ext}`,
              plannedStart: new Date("2026-09-05T10:00:00.000Z"),
              plannedEnd: new Date("2026-09-05T12:00:00.000Z"),
              durationMinutes: 120,
            },
          });
          await tx.booking.update({ where: { id: b.id }, data: { status: BookingStatus.cancelled } });
          await applyCancellationSideEffects(tx, b.id, null);
        });
        const still = await prisma.assignment.findFirst({ where: { booking: { externalBookingId: ext } } });
        expect(still).toBeNull();
      } finally {
        await prisma.$disconnect();
      }
    });

    await loginAsStaff(page);
    await expect(page.getByRole("heading", { level: 1, name: TODAY_HEADING })).toBeVisible({ timeout: 30_000 });
    await page.goto("/app/calendar");
    await expect(page.getByRole("heading", { level: 1, name: CALENDAR_HEADING })).toBeVisible({ timeout: 30_000 });

    // Sync runs API (observability without Redis worker).
    const runsOk = await page.evaluate(async () => {
      const res = await fetch("/api/sync/runs", { credentials: "include" });
      const json = (await res.json().catch(() => null)) as { data?: { runs?: unknown[] } } | null;
      return res.ok && Array.isArray(json?.data?.runs);
    });
    expect(runsOk).toBe(true);
  });
});

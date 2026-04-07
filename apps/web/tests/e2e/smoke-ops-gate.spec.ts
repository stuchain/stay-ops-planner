import { expect, test } from "@playwright/test";
import { BookingStatus, Channel, PrismaClient } from "@stay-ops/db";
import { applyCancellationSideEffects, applyHosthubReservation } from "@stay-ops/sync";
import { e2eCredentials, loginAsStaff, reseedE2EFixtures } from "./helpers";

test.describe("ops gate smoke @smoke", () => {
  test.beforeEach(() => {
    reseedE2EFixtures();
  });

  test("@smoke end-to-end operator loop", async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");

    await test.step("sync reservation upsert (pipeline)", async () => {
      const prisma = new PrismaClient();
      try {
        const rid = `e2e-smoke-ingest-${Date.now()}`;
        await applyHosthubReservation(
          prisma,
          {
            reservationId: rid,
            listingId: "e2e-smoke-listing",
            status: "confirmed",
            checkIn: "2026-08-01",
            checkOut: "2026-08-05",
            listingChannel: "airbnb",
          },
          {},
        );
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
    await page.goto("/app/calendar");
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

    // Assignment workflow from unassigned queue.
    await page.getByRole("button", { name: "Unassigned queue" }).click();
    const row = page.locator(".ops-drawer-row").filter({ hasText: "e2e-seed-unassign" });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByLabel(/Room for booking/).selectOption({ label: "E2E-A" });
    await row.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByTestId("ops-room-lane-E2E-A").getByText("E2E Unassigned")).toBeVisible({
      timeout: 20_000,
    });
    await page.locator(".ops-drawer").getByRole("button", { name: "Close" }).click();

    // Conflict rejection smoke via reassign API path.
    const monthYm = (await page.locator(".ops-month-title").textContent())?.trim() ?? "";
    const conflict = await page.evaluate(async (ym: string) => {
      const cal = await fetch(`/api/calendar/month?month=${encodeURIComponent(ym)}`, { credentials: "include" });
      if (!cal.ok) return { ok: false, status: cal.status };
      const body = (await cal.json()) as {
        data?: {
          rooms: { id: string; code: string | null }[];
          items: { kind: string; guestName?: string; assignmentId?: string | null; assignmentVersion?: number | null }[];
        };
      };
      const data = body.data;
      if (!data) return { ok: false, status: 0 };
      const bravo = data.items.find((i) => i.kind === "booking" && i.guestName === "E2E Bravo");
      const roomA = data.rooms.find((r) => r.code === "E2E-A");
      if (!bravo?.assignmentId || bravo.assignmentVersion == null || !roomA) {
        return { ok: false, status: 0 };
      }
      const res = await fetch(`/api/assignments/${encodeURIComponent(bravo.assignmentId)}/reassign`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomId: roomA.id, expectedVersion: bravo.assignmentVersion }),
      });
      const j = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      return { ok: true, status: res.status, code: j?.error?.code ?? null };
    }, monthYm);
    expect(conflict).toEqual({ ok: true, status: 409, code: "CONFLICT_ASSIGNMENT" });

    // Maintenance block create (UI) — short range on E2E-B to avoid overlapping seeded assignments.
    await page.getByRole("button", { name: "Add block" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add maintenance block" })).toBeVisible();
    const ymParts = monthYm.split("-");
    const y = Number(ymParts[0]);
    const m = Number(ymParts[1]);
    const pad = (n: number) => String(n).padStart(2, "0");
    const start = `${y}-${pad(m)}-01`;
    const end = `${y}-${pad(m)}-03`;
    await dialog.getByRole("combobox").selectOption({ label: "E2E-B — E2E Room B" });
    await dialog.getByLabel(/^Start date$/i).fill(start);
    await dialog.getByLabel(/^End date$/i).fill(end);
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Cleaning lifecycle smoke.
    await page.goto("/app/cleaning");
    await expect(page.getByTestId("ops-cleaning-board")).toBeVisible();
    const startBtn = page.locator('[data-testid^="ops-cleaning-start-"]').first();
    await expect(startBtn).toBeVisible({ timeout: 20_000 });
    await startBtn.click();
    const completeBtn = page.locator('[data-testid^="ops-cleaning-complete-"]').first();
    await expect(completeBtn).toBeVisible({ timeout: 10_000 });
    await completeBtn.click();

    // Sync runs API (observability without Redis worker).
    const runsOk = await page.evaluate(async () => {
      const res = await fetch("/api/sync/runs", { credentials: "include" });
      const json = (await res.json().catch(() => null)) as { data?: { runs?: unknown[] } } | null;
      return res.ok && Array.isArray(json?.data?.runs);
    });
    expect(runsOk).toBe(true);

    // Audit history smoke: route loads and filter can be used.
    await page.goto("/app/audit");
    await expect(page.getByRole("heading", { name: "Audit history" })).toBeVisible();
    await page.getByLabel("Entity type").fill("assignment");
    await expect(page.locator(".ops-drawer-row").first()).toBeVisible({ timeout: 10_000 });
  });
});

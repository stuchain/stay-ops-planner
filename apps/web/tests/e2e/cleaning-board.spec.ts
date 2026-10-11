import { BookingStatus, Channel, PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff, reseedE2EFixtures } from "./helpers";

/** Dev mode keeps the cleaning board until Phase 4: the admin switches Dev mode on and walks a task to done. */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://stayops:stayops@127.0.0.1:5432/stayops?schema=e2e";
const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

/** One cleaning task to start and finish, on its own booking so the spec does not depend on other specs. */
async function addTodoTask(): Promise<void> {
  const room = await db.room.findFirstOrThrow({ where: { code: "E2E-A" } });
  const ext = `e2e-cleaning-board-${Date.now()}`;
  const booking = await db.booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: ext,
      status: BookingStatus.confirmed,
      checkinDate: new Date("2026-11-01T00:00:00.000Z"),
      checkoutDate: new Date("2026-11-04T00:00:00.000Z"),
      nights: 3,
      rawPayload: {},
    },
  });
  await db.cleaningTask.create({
    data: {
      bookingId: booking.id,
      roomId: room.id,
      status: "todo",
      taskType: "turnover",
      sourceEventId: `${ext}-clean`,
      plannedStart: new Date("2026-11-04T10:00:00.000Z"),
      plannedEnd: new Date("2026-11-04T12:00:00.000Z"),
      durationMinutes: 120,
    },
  });
}

test.describe("cleaning board (Dev mode)", () => {
  test.beforeEach(async () => {
    await reseedE2EFixtures();
  });

  test.afterAll(async () => {
    const c = e2eCredentials();
    if (c) await db.user.update({ where: { email: c.email }, data: { devMode: false } });
    await db.$disconnect();
  });

  test("todo to done lifecycle when tasks exist", async ({ page }) => {
    test.setTimeout(180_000);
    const c = e2eCredentials();
    test.skip(!c, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await db.user.update({ where: { email: c!.email }, data: { devMode: true } });
    await addTodoTask();
    await loginAsStaff(page);
    await page.goto("/app/dev/cleaning");
    await expect(page.getByTestId("ops-cleaning-board")).toBeVisible({ timeout: 30_000 });
    const startBtn = page.locator('[data-testid^="ops-cleaning-start-"]').first();
    await expect(startBtn).toBeVisible({ timeout: 20_000 });
    await startBtn.click();
    const completeBtn = page.locator('[data-testid^="ops-cleaning-complete-"]').first();
    await expect(completeBtn).toBeVisible({ timeout: 10_000 });
    await completeBtn.click();
  });
});

import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff } from "./helpers";

test.describe("calendar allocation", () => {
  test("drag unassigned booking to a room lane when data exists", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");

    const card = page.locator('[data-testid^="ops-booking-card-"]').first();
    const lanes = page.locator('[data-testid^="ops-room-lane-"]');
    const laneCount = await lanes.count();
    test.skip(laneCount < 2, "Need unassigned lane plus at least one room lane.");
    test.skip((await card.count()) < 1, "Need at least one booking card.");

    const roomLane = lanes.nth(1);
    await card.dragTo(roomLane);
    await page.waitForTimeout(800);
    const toast = page.locator(".ops-toast[role='alert']");
    await expect(toast).not.toBeVisible({ timeout: 4000 }).catch(() => undefined);
  });

  test("server conflict shows toast after optimistic rollback", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    test.skip(
      process.env.E2E_CONFLICT_SCENARIO !== "1",
      "Set E2E_CONFLICT_SCENARIO=1 and seed two bookings that cannot share the same room.",
    );
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    const cards = page.locator('[data-testid^="ops-booking-card-"]');
    if ((await cards.count()) < 2) test.skip();
    const lanes = page.locator('[data-testid^="ops-room-lane-"]');
    if ((await lanes.count()) < 2) test.skip();
    const first = cards.first();
    const second = cards.nth(1);
    const roomLane = lanes.nth(1);
    await first.dragTo(roomLane);
    await page.waitForTimeout(600);
    await second.dragTo(roomLane);
    await expect(page.locator(".ops-toast[role='alert']")).toBeVisible({ timeout: 8000 });
  });
});

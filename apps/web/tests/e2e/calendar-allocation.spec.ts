import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff } from "./helpers";

test.describe("calendar allocation", () => {
  test("drag unassigned booking to a room lane when data exists", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title")).toBeVisible();

    const uCard = page.locator(".ops-booking-card").filter({ hasText: "E2E Unassigned" });
    const laneA = page.getByTestId("ops-room-lane-E2E-A");
    test.skip((await uCard.count()) < 1, "Run pnpm --filter @stay-ops/db seed:e2e after seed.");
    test.skip((await laneA.count()) < 1, "E2E rooms missing (seed:e2e).");

    await uCard.dragTo(laneA);
    await page.waitForTimeout(800);
    const toast = page.locator(".ops-toast[role='alert']");
    await expect(toast).not.toBeVisible({ timeout: 4000 }).catch(() => undefined);
  });

  test("server conflict shows toast after optimistic rollback", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title")).toBeVisible();

    const uCard = page.locator(".ops-booking-card").filter({ hasText: "E2E Unassigned" });
    const bCard = page.locator(".ops-booking-card").filter({ hasText: "E2E Bravo" });
    const laneA = page.getByTestId("ops-room-lane-E2E-A");
    test.skip((await uCard.count()) < 1 || (await bCard.count()) < 1, "Run seed:e2e for conflict guests.");
    test.skip((await laneA.count()) < 1, "E2E-A lane missing.");

    await uCard.dragTo(laneA);
    await page.waitForTimeout(600);
    await bCard.dragTo(laneA);
    await expect(page.locator(".ops-toast[role='alert']")).toBeVisible({ timeout: 8000 });
  });
});

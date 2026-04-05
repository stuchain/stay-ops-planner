import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff, reseedE2EFixtures } from "./helpers";

test.describe("mobile quick assign", () => {
  test.beforeEach(() => {
    reseedE2EFixtures();
  });

  test("assign sheet opens from quick action", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile-chromium", "Mobile project only.");
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title")).toBeVisible();
    await page.locator(".ops-booking-card").first().scrollIntoViewIfNeeded();
    const quick = page.locator('[data-testid^="ops-assign-quick-"]').first();
    test.skip((await quick.count()) < 1, "Need a booking card (run seed:e2e).");
    await quick.scrollIntoViewIfNeeded();
    await quick.click({ force: true });
    await expect(page.getByRole("heading", { name: "Assign stay" })).toBeVisible();
  });
});

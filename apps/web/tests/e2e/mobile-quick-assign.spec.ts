import { expect, test } from "@playwright/test";
import { e2eCredentials, gotoCalendarAndWaitReady, loginAsStaff, reseedE2EFixtures } from "./helpers";

test.describe("mobile quick assign", () => {
  test.beforeEach(async () => {
    await reseedE2EFixtures();
  });

  test("assign sheet opens from quick action", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile-chromium", "Mobile project only.");
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await gotoCalendarAndWaitReady(page);
    await page.locator(".ops-booking-card").first().scrollIntoViewIfNeeded();
    const quick = page.locator('[data-testid^="ops-assign-quick-"]').first();
    test.skip((await quick.count()) < 1, "Need a booking card (run seed:e2e).");
    await quick.scrollIntoViewIfNeeded();
    await quick.click({ force: true });
    await expect(page.getByRole("heading", { name: "Assign stay" })).toBeVisible();
  });

  test("assign sheet Escape closes", { tag: "@a11y" }, async ({ page }) => {
    test.skip(test.info().project.name !== "mobile-chromium", "Mobile project only.");
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await gotoCalendarAndWaitReady(page);
    await page.locator(".ops-booking-card").first().scrollIntoViewIfNeeded();
    const quick = page.locator('[data-testid^="ops-assign-quick-"]').first();
    test.skip((await quick.count()) < 1, "Need a booking card (run seed:e2e).");
    await quick.scrollIntoViewIfNeeded();
    await quick.click({ force: true });
    await expect(page.getByRole("dialog", { name: "Assign stay" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Assign stay" })).toBeHidden();
  });
});

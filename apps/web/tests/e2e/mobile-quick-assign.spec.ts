import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff } from "./helpers";

test.describe("mobile quick assign", () => {
  test("assign sheet opens from quick action", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile-chromium", "Mobile project only.");
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    const quick = page.locator('[data-testid^="ops-assign-quick-"]').filter({ hasText: "Assign" }).first();
    test.skip((await quick.count()) < 1, "Need a booking card (run seed:e2e for E2E Unassigned).");
    await quick.click();
    await expect(page.getByRole("heading", { name: "Assign stay" })).toBeVisible();
  });
});

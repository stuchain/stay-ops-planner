import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff, reseedE2EFixtures } from "./helpers";

test.describe("cleaning board", () => {
  test.beforeEach(async () => {
    await reseedE2EFixtures();
  });

  test("todo to done lifecycle when tasks exist", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/cleaning");
    await expect(page.getByTestId("ops-cleaning-board")).toBeVisible();
    const startBtn = page.locator('[data-testid^="ops-cleaning-start-"]').first();
    await expect(startBtn).toBeVisible({ timeout: 20_000 });
    await startBtn.click();
    const completeBtn = page.locator('[data-testid^="ops-cleaning-complete-"]').first();
    await expect(completeBtn).toBeVisible({ timeout: 10_000 });
    await completeBtn.click();
  });
});

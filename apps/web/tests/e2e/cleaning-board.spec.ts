import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff } from "./helpers";

test.describe("cleaning board", () => {
  test("todo to done lifecycle when tasks exist", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/cleaning");
    await expect(page.getByTestId("ops-cleaning-board")).toBeVisible();

    const startBtn = page.locator('[data-testid^="ops-cleaning-start-"]').first();
    if ((await startBtn.count()) < 1) {
      test.skip(true, "No todo cleaning tasks in DB for this filter.");
    }
    await startBtn.click();
    const completeBtn = page.locator('[data-testid^="ops-cleaning-complete-"]').first();
    await expect(completeBtn).toBeVisible({ timeout: 10_000 });
    await completeBtn.click();
  });
});

import { expect, test } from "@playwright/test";
import { CALENDAR_HEADING, TODAY_HEADING, e2eCredentials, loginAsStaff } from "./helpers";

test.describe("login and app shell", () => {
  test.setTimeout(180_000);

  test("login lands on Today", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (match db seed).");
    await loginAsStaff(page);
    await expect(page.getByRole("heading", { level: 1, name: TODAY_HEADING })).toBeVisible({ timeout: 30_000 });
  });

  test("the menu opens the calendar", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    test.skip(test.info().project.name === "mobile-chromium", "Desktop sidebar only.");
    await loginAsStaff(page);
    await page.getByRole("navigation").getByRole("link", { name: CALENDAR_HEADING }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: CALENDAR_HEADING })).toBeVisible({ timeout: 30_000 });
  });
});

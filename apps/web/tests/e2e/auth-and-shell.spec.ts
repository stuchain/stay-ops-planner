import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff } from "./helpers";

test.describe("login and app shell", () => {
  test("login redirects to calendar", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (match db seed).");
    await loginAsStaff(page);
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  });

  test("calendar links to cleaning board", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.getByRole("link", { name: "Cleaning" }).click();
    await expect(page.getByRole("heading", { name: "Cleaning board" })).toBeVisible();
  });
});

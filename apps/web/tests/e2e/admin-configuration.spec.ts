import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff, reseedE2EFixtures } from "./helpers";

test.describe("admin configuration", () => {
  test.beforeEach(() => {
    reseedE2EFixtures();
  });

  test("loads admin page and persists a threshold update", async ({ page }) => {
    test.skip(
      test.info().project.name === "mobile-chromium",
      "Admin configuration smoke is covered on desktop.",
    );
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");

    await loginAsStaff(page);
    await page.goto("/app/admin/configuration");
    await expect(page.getByRole("heading", { name: "Admin configuration" })).toBeVisible();

    await page.getByLabel("Key").selectOption("unassigned_backlog_count");
    await page.getByLabel("Numeric value").fill("17");
    await page.getByRole("button", { name: "Save threshold" }).click();

    await expect(page.getByText(/Configured thresholds:/)).toBeVisible();
    await expect(page.getByText(/"numericValue": "17"/)).toBeVisible({ timeout: 10_000 });
  });
});

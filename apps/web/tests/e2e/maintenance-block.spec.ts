import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff } from "./helpers";

test.describe("maintenance blocks", () => {
  test("open add block modal and cancel", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: "Add block" }).click();
    await expect(page.getByRole("heading", { name: "Add maintenance block" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Add maintenance block" })).not.toBeVisible();
  });

  test("overlap error when creating invalid block", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title")).toBeVisible();
    test.skip((await page.getByTestId("ops-room-lane-E2E-A").count()) < 1, "Run seed:e2e for overlap block on E2E-A.");
    const ym = (await page.locator(".ops-month-title").textContent())?.trim();
    test.skip(!ym || !/^\d{4}-\d{2}$/.test(ym), "Could not read calendar month from UI.");

    await page.getByRole("button", { name: "Add block" }).click();
    await page.getByLabel("Start date").fill(`${ym}-10`);
    await page.getByLabel("End date").fill(`${ym}-12`);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(
      page.getByRole("dialog").locator(".ops-modal-form .ops-error"),
    ).toBeVisible({ timeout: 8000 });
  });
});

import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff, reseedE2EFixtures } from "./helpers";

test.describe("maintenance blocks", () => {
  test.beforeEach(() => {
    reseedE2EFixtures();
  });

  test("open add block modal and cancel", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: "Block dates" }).click();
    await expect(page.getByRole("heading", { name: "Add maintenance block" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Add maintenance block" })).not.toBeVisible();
  });

  test("open edit on seeded block and cancel", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title")).toBeVisible();
    test.skip((await page.getByTestId("ops-room-lane-E2E-A").count()) < 1, "Run seed:e2e for E2E-A lane.");

    const chip = page.getByTestId("ops-room-lane-E2E-A").locator('[data-testid^="ops-block-chip-"]').first();
    test.skip((await chip.count()) < 1, "Block chips are not rendered on desktop timeline view.");
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit maintenance block" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Edit maintenance block" })).not.toBeVisible();
  });

  test("delete seeded maintenance block after confirm", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title")).toBeVisible();
    test.skip((await page.getByTestId("ops-room-lane-E2E-A").count()) < 1, "Run seed:e2e for E2E-A lane.");

    const chip = page.getByTestId("ops-room-lane-E2E-A").locator('[data-testid^="ops-block-chip-"]').first();
    test.skip((await chip.count()) < 1, "Block chips are not rendered on desktop timeline view.");
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit maintenance block" })).toBeVisible();

    page.once("dialog", (d) => {
      expect(d.message()).toContain("Delete this maintenance block");
      void d.accept();
    });
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name: "Edit maintenance block" })).not.toBeVisible();
    await expect(
      page.getByTestId("ops-room-lane-E2E-A").locator('[data-testid^="ops-block-chip-"]'),
    ).toHaveCount(0, { timeout: 15_000 });
  });

  test("overlap error when creating invalid block", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title")).toBeVisible();
    test.skip((await page.getByTestId("ops-room-lane-E2E-A").count()) < 1, "Run seed:e2e for overlap block on E2E-A.");
    const ym = (await page.locator(".ops-month-title").textContent())?.trim();
    test.skip(!ym || !/^\d{4}-\d{2}$/.test(ym), "Could not read calendar month from UI.");

    await page.getByRole("button", { name: "Block dates" }).click();
    await page.getByLabel("Start date").fill(`${ym}-10`);
    await page.getByLabel("End date").fill(`${ym}-12`);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(
      page.getByRole("dialog").locator(".ops-modal-form .ops-error"),
    ).toBeVisible({ timeout: 8000 });
  });
});

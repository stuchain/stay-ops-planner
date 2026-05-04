/**
 * Screenshot baselines (opt-in): from `apps/web` run
 *   pnpm run test:e2e:visual -- --update-snapshots
 * Requires DB seed + `E2E_ADMIN_*` (see README / e2e workflow). Commit `*-snapshots/*.png`.
 * Default `pnpm test:e2e` skips this project unless `PLAYWRIGHT_VISUAL=1` (see `playwright.config.ts`).
 */
import { test, expect } from "@playwright/test";
import { e2eCredentials, gotoCalendarAndWaitReady, loginAsStaff } from "../helpers";

test.describe("visual snapshots", { tag: "@visual" }, () => {
  test.beforeEach(() => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (match seed).");
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("ops.calendar.month", "2026-06");
      window.localStorage.setItem("ops.calendar.displayMonths", "1");
    });
    await loginAsStaff(page);
  });

  test("calendar month view", async ({ page }) => {
    await gotoCalendarAndWaitReady(page);
    await expect(page).toHaveScreenshot("calendar.png", {
      fullPage: true,
      maxDiffPixels: 400,
      animations: "disabled",
    });
  });

  test("bookings list header", async ({ page }) => {
    await page.goto("/app/bookings");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveScreenshot("bookings.png", {
      fullPage: true,
      maxDiffPixels: 400,
      animations: "disabled",
    });
  });

  test("settings language section", async ({ page }) => {
    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveScreenshot("settings.png", {
      fullPage: true,
      maxDiffPixels: 500,
      animations: "disabled",
    });
  });
});

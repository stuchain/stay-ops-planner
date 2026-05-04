import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff, reseedE2EFixtures } from "./helpers";

test.describe("critical journey @smoke", () => {
  test.beforeEach(() => {
    reseedE2EFixtures();
  });

  test("@smoke login → calendar sync warnings → booking detail", async ({ page }) => {
    test.setTimeout(90_000);
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");

    await loginAsStaff(page);

    await test.step("calendar shows sync warnings strip", async () => {
      await page.goto("/app/calendar");
      await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
      await expect(page.locator('input[type="month"]').first()).toBeVisible({ timeout: 15_000 });
      const warningsStrip = page.getByRole("status").filter({ hasText: /sync warning\(s\) found/i });
      await expect(warningsStrip).toBeVisible({ timeout: 15_000 });
    });

    await test.step("open sync warnings modal and assert seeded marker", async () => {
      await page.getByRole("button", { name: "View sync warning details" }).click();
      const dialog = page.getByRole("dialog", { name: /Sync warnings/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: /Sync warnings \(1\)/ })).toBeVisible();
      await expect(dialog.getByText("E2E seeded sync warning")).toBeVisible();
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(dialog).toBeHidden();
    });

    await test.step("bookings list → detail modal", async () => {
      await page.goto("/app/bookings");
      await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();
      await expect(page.getByText("Loading bookings...")).toBeHidden({ timeout: 20_000 });
      const alphaRow = page.getByRole("button", { name: /Open booking e2e-seed-alpha/i });
      await alphaRow.scrollIntoViewIfNeeded();
      await alphaRow.focus();
      await page.keyboard.press("Enter");

      const detail = page.getByRole("dialog", { name: "Booking details" });
      await expect(detail).toBeVisible({ timeout: 15_000 });
      await expect(detail.getByText("E2E Alpha")).toBeVisible();
      await expect(detail.getByText("Check-in", { exact: true })).toBeVisible();
      await detail.getByRole("button", { name: "Close" }).click();
      await expect(detail).toBeHidden();
    });
  });
});

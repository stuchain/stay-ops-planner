import { expect, test, type Page } from "@playwright/test";
import { e2eCredentials, loginAsStaff, reseedE2EFixtures } from "./helpers";

/** Desktop path: dnd-kit + Playwright `dragTo` is flaky on Windows headless; queue uses the same mutation as drag. */
async function assignE2EUnassignedToRoomA(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Unassigned queue" }).click();
  await expect(page.getByRole("heading", { name: "Unassigned queue" })).toBeVisible();
  const row = page.locator(".ops-drawer-row").filter({ hasText: "e2e-seed-unassign" });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByLabel(/Room for booking/).selectOption({ label: "E2E-A" });
  await row.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByTestId("ops-room-lane-E2E-A").getByText("E2E Unassigned")).toBeVisible({
    timeout: 20_000,
  });
  await page.locator(".ops-drawer").getByRole("button", { name: "Close" }).click();
}

test.describe("calendar allocation", () => {
  test.beforeEach(() => {
    reseedE2EFixtures();
  });

  test("assign unassigned booking to E2E-A via queue when data exists", async ({ page }) => {
    test.skip(
      test.info().project.name === "mobile-chromium",
      "Narrow viewports use quick assign; see mobile-quick-assign.spec.ts.",
    );
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title")).toBeVisible();
    test.skip((await page.getByTestId("ops-room-lane-E2E-A").count()) < 1, "E2E rooms missing (seed:e2e).");

    await assignE2EUnassignedToRoomA(page);
  });

  test("server conflict shows toast after optimistic rollback", async ({ page }) => {
    test.skip(
      process.platform === "win32",
      "Playwright + dnd-kit second-card conflict is unreliable on Windows headless; allocation conflicts are covered in apps/web/tests/integration.",
    );
    test.skip(
      test.info().project.name === "mobile-chromium",
      "DnD assignment is disabled when isMobile; use quick-assign specs on mobile.",
    );
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title")).toBeVisible();

    const laneA = page.getByTestId("ops-room-lane-E2E-A");
    const laneADrop = laneA.locator(".ops-room-lane-body").first();
    const bCard = page.locator(".ops-booking-card").filter({ hasText: "E2E Bravo" });
    test.skip((await bCard.count()) < 1, "Run seed:e2e for conflict guests.");
    test.skip((await laneA.count()) < 1, "E2E-A lane missing.");

    await assignE2EUnassignedToRoomA(page);

    await bCard.scrollIntoViewIfNeeded();
    await bCard.dragTo(laneADrop, { force: true });
    await expect(page.locator(".ops-toast[role='alert']")).toBeVisible({ timeout: 15_000 });
  });
});

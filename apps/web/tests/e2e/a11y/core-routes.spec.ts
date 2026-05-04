/**
 * Epic 9: automated WCAG 2.x Level A + AA checks (axe) on core routes. Blocking in CI with `@a11y`.
 * Manual keyboard checklist: login → calendar (drawer, mobile sheet) → bookings → settings.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { e2eCredentials, gotoCalendarAndWaitReady, loginAsStaff } from "../helpers";

type AxeViolation = {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { html: string }[];
};

function summarizeViolations(violations: AxeViolation[]) {
  return violations
    .map(
      (vi) =>
        `${vi.id} [${vi.impact ?? "?"}]: ${vi.help}\n  ${vi.nodes
          .slice(0, 5)
          .map((n: { html: string }) => n.html)
          .join("\n  ")}`,
    )
    .join("\n---\n");
}

async function assertAxeClean(page: import("@playwright/test").Page, context: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, `${context}\n${summarizeViolations(results.violations)}`).toEqual([]);
}

test.describe("a11y core routes", { tag: "@a11y" }, () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", "Axe suite runs on desktop project only.");
  });

  test("login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Stay Ops Planner" })).toBeVisible({
      timeout: 15_000,
    });
    await assertAxeClean(page, "login");
  });

  test("calendar, bookings, settings (authenticated)", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await gotoCalendarAndWaitReady(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    await assertAxeClean(page, "calendar");

    await page.goto("/app/bookings");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    await assertAxeClean(page, "bookings");

    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    await assertAxeClean(page, "settings");
  });
});

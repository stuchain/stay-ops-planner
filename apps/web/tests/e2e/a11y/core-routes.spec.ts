/**
 * Epic 9: automated WCAG 2.x Level A + AA checks (axe) on core routes. Blocking in CI with `@a11y`.
 * Manual keyboard checklist: login → today → calendar (booking panel) → settings.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SETTINGS_HEADING, TODAY_HEADING, e2eCredentials, gotoCalendarAndWaitReady, loginAsStaff } from "../helpers";

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
    await expect(page.getByRole("heading", { level: 1, name: "Σύνδεση" })).toBeVisible({
      timeout: 15_000,
    });
    await assertAxeClean(page, "login");
  });

  test("today, calendar, settings (authenticated)", async ({ page }) => {
    // Visits several routes; the first run pays for the dev server compiling each of them.
    test.setTimeout(240_000);
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await expect(page.getByRole("heading", { level: 1, name: TODAY_HEADING })).toBeVisible({ timeout: 30_000 });
    await assertAxeClean(page, "today");

    await gotoCalendarAndWaitReady(page);
    await assertAxeClean(page, "calendar");

    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { level: 1, name: SETTINGS_HEADING })).toBeVisible({ timeout: 20_000 });
    await assertAxeClean(page, "settings");
  });
});

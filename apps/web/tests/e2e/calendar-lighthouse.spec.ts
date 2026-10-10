import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import lighthouse from "lighthouse";
import { CAL_USER, closeCalendarFixtures, resetCalendarFixtures } from "./calendarFixtures";

/**
 * Lighthouse budget for the new calendar (P1B-11): performance at least 90, accessibility at least 95,
 * desktop settings. Run against a production build (`next build && next start`), not the dev server:
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 PLAYWRIGHT_NO_SERVER=1 pnpm e2e:lighthouse
 * Skipped unless LIGHTHOUSE=1, so the dev-server e2e runs leave it out.
 */
const BUDGET = { performance: 0.9, accessibility: 0.95 } as const;
const PORT = 9333;

test.describe("calendar Lighthouse budget @lighthouse", () => {
  test.skip(process.env.LIGHTHOUSE !== "1", "Set LIGHTHOUSE=1 and run against a production build.");
  let context: BrowserContext;
  let profile: string;

  test.beforeAll(async ({ baseURL }) => {
    test.setTimeout(120_000);
    await resetCalendarFixtures();
    profile = mkdtempSync(path.join(tmpdir(), "lh-profile-"));
    // A persistent context is the browser's default one, so the tab Lighthouse opens shares its login cookie.
    context = await chromium.launchPersistentContext(profile, {
      args: [`--remote-debugging-port=${PORT}`],
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    });
    const page = await context.newPage();
    await page.goto(`${baseURL}/login`);
    await page.getByTestId("login-email").fill(CAL_USER.email);
    await page.getByTestId("login-password").fill(CAL_USER.password);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/app\/(today|calendar)/);
    await page.close();
  });

  test.afterAll(async () => {
    await context?.close();
    if (profile) rmSync(profile, { recursive: true, force: true });
    await closeCalendarFixtures();
  });

  test("calendar meets the performance and accessibility budget", async ({ baseURL }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "Runs once, on desktop.");
    test.setTimeout(180_000);
    const result = await lighthouse(
      `${baseURL}/app/calendar`,
      { port: PORT, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility"] },
      {
        extends: "lighthouse:default",
        settings: {
          formFactor: "desktop",
          screenEmulation: { mobile: false, width: 1366, height: 768, deviceScaleFactor: 1, disabled: false },
          throttlingMethod: "simulate",
          throttling: { rttMs: 40, throughputKbps: 10_240, cpuSlowdownMultiplier: 1 },
        },
      },
    );
    const categories = result?.lhr.categories;
    const scores = {
      performance: categories?.performance?.score ?? 0,
      accessibility: categories?.accessibility?.score ?? 0,
    };
    await test
      .info()
      .attach("lighthouse-scores", { body: JSON.stringify(scores, null, 2), contentType: "application/json" });
    console.log(`Lighthouse /app/calendar: ${JSON.stringify(scores)}`);
    expect(result?.lhr.finalDisplayedUrl).toContain("/app/calendar");
    expect(scores.performance).toBeGreaterThanOrEqual(BUDGET.performance);
    expect(scores.accessibility).toBeGreaterThanOrEqual(BUDGET.accessibility);
  });
});

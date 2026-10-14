import { expect, test, type Page } from "@playwright/test";
import { CAL_USER, closeCalendarFixtures, resetCalendarFixtures } from "./calendarFixtures";

/**
 * Production hardening: every screen opens cleanly, and when something goes wrong (a wrong password, a page that
 * does not exist, a server error, no internet) the person sees a plain sentence and a way forward.
 * Uses the Greek calendar-journey user and fixtures.
 */

async function login(page: Page, next?: string): Promise<void> {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByTestId("login-email").fill(CAL_USER.email);
  await page.getByTestId("login-password").fill(CAL_USER.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/app\//, { timeout: 60_000 });
}

/** Collects what a person would never want to see: uncaught page errors and server failures. */
function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  // Anything the Content-Security-Policy blocks would be a broken feature in production.
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) problems.push(`CSP: ${message.text()}`);
  });
  page.on("response", (response) => {
    // The background Hosthub sync answers 503 here because the test database has no Hosthub key.
    if (response.url().includes("/api/sync/hosthub/reconcile")) return;
    if (response.status() >= 500) problems.push(`HTTP ${response.status()} ${response.url()}`);
  });
  return problems;
}

const SCREENS = [
  "/app/today",
  "/app/calendar",
  "/app/free",
  "/app/excel",
  "/app/cleaning",
  "/app/turnovers",
  "/app/arrival-cards",
  "/app/search",
  "/app/week",
  "/app/settings",
] as const;

test.describe("hardening @calendar", () => {
  test.use({ viewport: { width: 1366, height: 768 }, locale: "el-GR", contextOptions: { reducedMotion: "reduce" } });

  test.beforeAll(async () => {
    await resetCalendarFixtures();
  });

  test.beforeEach(async () => {
    test.skip(test.info().project.name === "mobile-chromium", "Desktop layout only.");
    test.setTimeout(180_000);
  });

  test.afterAll(async () => {
    await closeCalendarFixtures();
  });

  test("every screen opens with a heading and no errors", async ({ page }) => {
    const problems = watchForProblems(page);
    await login(page);
    for (const path of SCREENS) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }), `heading on ${path}`).toBeVisible({ timeout: 60_000 });
      // No screen is left showing its error box.
      await expect(page.getByRole("main").getByRole("alert"), `error box on ${path}`).toHaveCount(0);
    }
    expect(problems).toEqual([]);
  });

  test("a wrong password says so and stays on the login page", async ({ page }) => {
    await page.goto("/login");
    // A made-up address, so the real users are never locked out by this test.
    await page.getByTestId("login-email").fill(`nobody-${Date.now()}@stayops.local`);
    await page.getByTestId("login-password").fill("not-the-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByText("Η διεύθυνση ή ο κωδικός δεν είναι σωστά. Δοκιμάστε ξανά.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("login-submit")).toBeEnabled();
  });

  test("login without internet says so instead of hanging", async ({ page, context }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(CAL_USER.email);
    await page.getByTestId("login-password").fill(CAL_USER.password);
    await context.setOffline(true);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toContainText("Δεν υπάρχει σύνδεση στο ίντερνετ");
    await context.setOffline(false);
  });

  test("login never follows a link to another site", async ({ page, baseURL }) => {
    await login(page, "//evil.example/steal");
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });

  test("an old or mistyped link shows a friendly page with a way home", async ({ page }) => {
    await login(page);
    await page.goto("/app/this-page-does-not-exist");
    await expect(page.getByText("Η σελίδα δεν βρέθηκε")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Στην αρχική" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Σήμερα" })).toBeVisible({ timeout: 30_000 });
  });

  test("a server error shows a plain message, and Δοκιμάστε ξανά recovers", async ({ page }) => {
    await login(page);
    await page.goto("/app/today");
    await expect(page.getByRole("heading", { level: 1, name: "Σήμερα" })).toBeVisible({ timeout: 30_000 });

    // Every data request now fails the way a crashed server would.
    await page.route("**/api/trpc/**", (route) =>
      route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" }),
    );
    await page.reload();
    const alert = page.getByRole("main").getByRole("alert").first();
    await expect(alert).toBeVisible({ timeout: 30_000 });
    // A sentence a person would say, never the server's own text.
    await expect(alert).not.toContainText("Internal Server Error");

    await page.unroute("**/api/trpc/**");
    await alert.getByRole("button", { name: "Δοκιμάστε ξανά" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Αύριο" })).toBeVisible();
  });

  test("losing the internet shows a banner, and it goes away when it is back", async ({ page, context }) => {
    await login(page);
    await page.goto("/app/today");
    await expect(page.getByRole("region", { name: "Αύριο" })).toBeVisible({ timeout: 30_000 });

    await context.setOffline(true);
    const banner = page.getByRole("status").filter({ hasText: "Χωρίς σύνδεση στο ίντερνετ" });
    await expect(banner).toBeVisible();
    // The last data stays on screen.
    await expect(page.getByRole("region", { name: "Αύριο" })).toBeVisible();

    await context.setOffline(false);
    await expect(banner).toBeHidden({ timeout: 15_000 });
  });

  test("money: a manual row is checked, added and deleted only after asking", async ({ page }) => {
    const name = `E2E Επιστροφή ${Date.now()}`;
    await login(page);
    await page.goto("/app/excel");
    await page.getByRole("button", { name: "Σαν το Excel" }).click();
    await page.getByRole("button", { name: "Νέα εγγραφή" }).click();

    const panel = page.getByRole("dialog", { name: "Νέα χειροκίνητη εγγραφή" });
    await panel.getByLabel("Όνομα").fill(name);
    await panel.getByLabel("Ποσό", { exact: true }).fill("δώδεκα");
    await panel.getByRole("button", { name: "Προσθήκη" }).click();
    // A typo is explained next to the field, never saved as zero.
    await expect(panel.getByText("Γράψτε ένα ποσό, για παράδειγμα 1.234,56")).toBeVisible();

    // Greek number format, as the father types it.
    await panel.getByLabel("Ποσό", { exact: true }).fill("-1.234,56");
    await panel.getByRole("button", { name: "Προσθήκη" }).click();
    await expect(page.getByText("Η εγγραφή προστέθηκε")).toBeVisible();
    await page.keyboard.press("Escape");
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();
    // Written the way his Excel shows it, without thousands dots.
    await expect(row).toContainText("-1234,56");

    // Deleting asks first, in the bar above the sheet.
    await row.getByRole("gridcell", { name: /ΟΝΟΜΑ ΚΑΙ ΑΤΟΜΑ/ }).click();
    await page.getByRole("button", { name: "Διαγραφή γραμμής" }).click();
    await page.getByRole("button", { name: "Ναι, διαγραφή" }).click();
    await expect(page.getByText("Η εγγραφή διαγράφηκε")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
  });

  test("the app answers with browser safety headers", async ({ request }) => {
    const response = await request.get("/login");
    const headers = response.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("the API refuses requests without a session, as JSON", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL: baseURL! });
    const response = await anonymous.get("/api/auth/me");
    expect(response.status()).toBe(401);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("UNAUTHORIZED");
    await anonymous.dispose();
  });
});

test.describe("hardening on a phone @calendar", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "el-GR",
    contextOptions: { reducedMotion: "reduce" },
  });

  test.beforeAll(async () => {
    await resetCalendarFixtures();
  });

  test.beforeEach(async () => {
    // The phone size is set here, so one run is enough.
    test.skip(test.info().project.name === "mobile-chromium", "Phone size is set by this describe.");
    test.setTimeout(180_000);
  });

  test.afterAll(async () => {
    await closeCalendarFixtures();
  });

  test("every screen opens on a phone without errors or sideways scrolling", async ({ page }) => {
    const problems = watchForProblems(page);
    await login(page);
    for (const path of SCREENS) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }), `heading on ${path}`).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("main").getByRole("alert"), `error box on ${path}`).toHaveCount(0);
      // Wide content (the calendar grid) scrolls inside its own box; the page itself never does.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `page wider than the phone on ${path}`).toBeLessThanOrEqual(1);
      // The bottom menu stays reachable.
      await expect(page.getByRole("navigation").last()).toBeVisible();
    }
    expect(problems).toEqual([]);
  });
});

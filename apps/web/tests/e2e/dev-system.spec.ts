import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { CAL_USER, closeCalendarFixtures, resetCalendarFixtures } from "./calendarFixtures";

/** P2-6: Dev mode History, Users and System, and the Greek login page with its lockout message. */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://stayops:stayops@127.0.0.1:5432/stayops?schema=e2e";
const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CAL_USER.email);
  await page.getByTestId("login-password").fill(CAL_USER.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/app\//);
}

const devNav = (page: Page) => page.getByRole("navigation", { name: "Λειτουργία προγραμματιστή" });

test.describe("Dev mode history, users and system @calendar", () => {
  test.use({ viewport: { width: 1366, height: 768 }, locale: "el-GR", contextOptions: { reducedMotion: "reduce" } });

  test.beforeEach(async () => {
    test.skip(test.info().project.name === "mobile-chromium", "Desktop layout only.");
    test.setTimeout(120_000);
    await resetCalendarFixtures();
    await db.user.update({ where: { email: CAL_USER.email }, data: { devMode: true } });
  });

  test.afterAll(async () => {
    await db.user.update({ where: { email: CAL_USER.email }, data: { devMode: false } });
    await db.loginAttempt.deleteMany({ where: { email: "nobody@example.com" } });
    await db.$disconnect();
    await closeCalendarFixtures();
  });

  test("the login page is Greek and counts down a lockout in minutes", async ({ page }) => {
    await db.loginAttempt.deleteMany({ where: { email: "nobody@example.com" } });
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Σύνδεση" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Είσοδος" })).toBeVisible();

    for (let i = 0; i < 5; i += 1) {
      await page.getByTestId("login-email").fill("nobody@example.com");
      await page.getByTestId("login-password").fill("wrong-password");
      await page.getByTestId("login-submit").click();
      await expect(page.getByTestId("login-error")).toContainText("δεν είναι σωστά");
    }
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toContainText(/Δοκιμάστε ξανά σε \d+ λεπτ/);
  });

  test("shows the history, the users and the system status", async ({ page }) => {
    await login(page);

    await devNav(page).getByRole("link", { name: "Ιστορικό" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Ιστορικό αλλαγών" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Συνδέθηκε στην εφαρμογή").first()).toBeVisible();
    await page.getByRole("button", { name: "Λεπτομέρειες" }).first().click();
    await expect(page.getByText("Ενέργεια:").first()).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Λήψη CSV" }).click();
    expect((await download).suggestedFilename()).toMatch(/^history-\d{4}-\d{2}-\d{2}\.csv$/);

    await devNav(page).getByRole("link", { name: "Χρήστες" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Χρήστες" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("cell", { name: CAL_USER.email })).toBeVisible();

    await devNav(page).getByRole("link", { name: "Σύστημα" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Σύστημα" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Λειτουργεί \(\d+ ms\)/)).toBeVisible();
  });
});

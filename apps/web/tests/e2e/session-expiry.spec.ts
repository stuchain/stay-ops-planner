import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { CAL_USER, closeCalendarFixtures, resetCalendarFixtures } from "./calendarFixtures";

/** E2-1: when the session runs out, signing in again on the page finishes the save that was refused. */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://stayops:stayops@127.0.0.1:5432/stayops?schema=e2e";
const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

test.describe("Session expiry @calendar", () => {
  test.use({ viewport: { width: 1366, height: 768 }, locale: "el-GR", contextOptions: { reducedMotion: "reduce" } });

  test.beforeEach(async () => {
    test.skip(test.info().project.name === "mobile-chromium", "Desktop layout only.");
    test.setTimeout(90_000);
    await resetCalendarFixtures();
    await db.user.update({ where: { email: CAL_USER.email }, data: { textSize: "normal" } });
  });

  test.afterAll(async () => {
    await db.user.update({ where: { email: CAL_USER.email }, data: { textSize: "normal" } });
    await db.$disconnect();
    await closeCalendarFixtures();
  });

  test("signs in again in place and the save still happens", async ({ page, context }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(CAL_USER.email);
    await page.getByTestId("login-password").fill(CAL_USER.password);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/app\//);
    await page.goto("/app/settings");
    const large = page.getByRole("radio", { name: /Μεγάλο/ });
    await expect(large).toBeVisible({ timeout: 30_000 });

    await context.clearCookies();
    await large.click();

    const dialog = page.getByRole("dialog", { name: "Η σύνδεση έληξε" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Email")).toHaveValue(CAL_USER.email);
    await dialog.getByLabel("Κωδικός").fill(CAL_USER.password);
    await dialog.getByRole("button", { name: "Σύνδεση" }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => (await db.user.findUniqueOrThrow({ where: { email: CAL_USER.email } })).textSize)
      .toBe("large");
    await expect(page).toHaveURL(/\/app\/settings/);
  });
});

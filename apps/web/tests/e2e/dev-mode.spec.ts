import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { CAL_USER, ROOM, closeCalendarFixtures, resetCalendarFixtures } from "./calendarFixtures";

/** P2-5: Dev mode is shown only to an admin who switched it on; the Apartments table edits and reorders. */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://stayops:stayops@127.0.0.1:5432/stayops?schema=e2e";
const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

async function setDevMode(on: boolean): Promise<void> {
  await db.user.update({ where: { email: CAL_USER.email }, data: { devMode: on } });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(CAL_USER.email);
  await page.getByLabel("Password").fill(CAL_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\//);
}

const devNav = (page: Page) => page.getByRole("navigation", { name: "Λειτουργία προγραμματιστή" });
const rowOf = (page: Page, name: string) => page.getByRole("row").filter({ hasText: name });

test.describe("Dev mode apartments @calendar", () => {
  test.use({ viewport: { width: 1366, height: 768 }, locale: "el-GR", contextOptions: { reducedMotion: "reduce" } });

  test.beforeEach(async () => {
    test.skip(test.info().project.name === "mobile-chromium", "Desktop layout only.");
    test.setTimeout(90_000);
    await resetCalendarFixtures();
  });

  test.afterAll(async () => {
    await setDevMode(false);
    await db.$disconnect();
    await closeCalendarFixtures();
  });

  test("is hidden and refused while Dev mode is off", async ({ page }) => {
    await setDevMode(false);
    await login(page);
    await page.goto("/app/dev/apartments");
    await expect(page.getByRole("heading", { name: "Δεν έχετε πρόσβαση" })).toBeVisible({ timeout: 30_000 });
    await expect(devNav(page)).toHaveCount(0);
  });

  test("edits an apartment and changes the calendar order", async ({ page }) => {
    await setDevMode(true);
    await login(page);
    await devNav(page).getByRole("link", { name: "Διαμερίσματα" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Διαμερίσματα" })).toBeVisible({ timeout: 30_000 });

    // Edit capacity in the panel.
    await expect(async () => {
      await rowOf(page, ROOM.beta).getByRole("button", { name: "Αλλαγή" }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByLabel("Χωρητικότητα (άτομα)").fill("2");
    await page.getByRole("button", { name: "Αποθήκευση" }).click();
    await expect(page.getByText("Το διαμέρισμα αποθηκεύτηκε.")).toBeVisible();
    await expect(rowOf(page, ROOM.beta).getByRole("cell").nth(2)).toHaveText("2");

    // Move Alpha below Beta with the arrow button.
    await rowOf(page, ROOM.alpha).getByRole("button", { name: `Μετακίνηση του ${ROOM.alpha} πιο κάτω` }).click();
    const names = page.getByRole("row").filter({ hasText: /Cal (Alpha|Beta)/ });
    await expect(names.first()).toContainText(ROOM.beta);

    await page.goto("/app/calendar");
    const groups = page.getByRole("group").filter({ hasText: /Cal (Alpha|Beta)/ });
    await expect(groups.first()).toHaveAttribute("aria-label", ROOM.beta, { timeout: 30_000 });
  });
});

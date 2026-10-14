import { expect, test, type Locator, type Page } from "@playwright/test";
import { CAL_USER, GUEST, ROOM, closeCalendarFixtures, resetCalendarFixtures } from "./calendarFixtures";

/** P2-7 polish: calendar keyboard shortcuts, no sideways page scroll at 150% zoom, and the installable-app manifest. */

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CAL_USER.email);
  await page.getByTestId("login-password").fill(CAL_USER.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/app\/today/);
}

async function openCalendar(page: Page): Promise<Locator> {
  await page.goto("/app/calendar");
  await expect(page.getByRole("heading", { level: 1, name: "Ημερολόγιο" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("group", { name: ROOM.alpha })).toBeVisible({ timeout: 30_000 });
  return page.getByRole("region", { name: "Ημερολόγιο" });
}

const scrollLeft = (grid: Locator) => grid.evaluate((el) => el.scrollLeft);

test.describe("Polish pass @calendar", () => {
  test.use({ viewport: { width: 1366, height: 768 }, locale: "el-GR", contextOptions: { reducedMotion: "reduce" } });

  test.beforeEach(async () => {
    test.skip(test.info().project.name === "mobile-chromium", "Desktop only.");
    test.setTimeout(90_000);
    await resetCalendarFixtures();
  });

  test.afterAll(async () => {
    await closeCalendarFixtures();
  });

  test("← → change month, T jumps back to today, Esc closes the booking panel", async ({ page }) => {
    await login(page);
    const grid = await openCalendar(page);
    // Wait until the grid has been scrolled to today.
    await expect.poll(() => scrollLeft(grid)).toBeGreaterThan(0);
    const start = await scrollLeft(grid);

    await page.keyboard.press("ArrowRight");
    await expect.poll(() => scrollLeft(grid)).toBeGreaterThan(start + 300);
    const nextMonth = await scrollLeft(grid);

    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => scrollLeft(grid)).toBeLessThan(nextMonth - 300);

    await page.keyboard.press("ArrowRight");
    await expect.poll(() => scrollLeft(grid)).toBeGreaterThan(start + 300);
    await page.keyboard.press("t");
    await expect.poll(() => scrollLeft(grid)).toBe(start);

    // Typing never triggers a shortcut, and neither does a modifier key.
    await page.keyboard.press("Control+ArrowRight");
    expect(await scrollLeft(grid)).toBe(start);

    // Esc closes the panel.
    const bar = page
      .getByRole("group", { name: ROOM.alpha })
      .getByRole("button", { name: new RegExp(`^${GUEST.placedInAlpha},`) });
    const panel = page.getByRole("dialog");
    await expect(async () => {
      await bar.click();
      await expect(panel).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("shortcuts stay quiet while typing in a field", async ({ page }) => {
    await login(page);
    const grid = await openCalendar(page);
    await expect.poll(() => scrollLeft(grid)).toBeGreaterThan(0);
    const start = await scrollLeft(grid);
    const bar = page
      .getByRole("group", { name: ROOM.alpha })
      .getByRole("button", { name: new RegExp(`^${GUEST.placedInAlpha},`) });
    const panel = page.getByRole("dialog");
    await expect(async () => {
      await bar.click();
      await expect(panel).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await panel.getByRole("button", { name: "Αλλαγή στοιχείων" }).click();
    await panel.getByRole("button", { name: "Αλλαγή", exact: true }).click();
    const field = panel.getByLabel("Όνομα επισκέπτη");
    await field.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("t");
    expect(await scrollLeft(grid)).toBe(start);
    await expect(panel).toBeVisible();
  });

  test("the manifest is served so the app can be installed", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBe("Διαμερίσματα");
    expect(manifest.start_url).toBe("/app/today");
    const sizes = (manifest.icons as { sizes: string; purpose?: string }[]).map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const icon of manifest.icons as { src: string }[]) {
      expect((await request.get(icon.src)).ok()).toBe(true);
    }
  });
});

test.describe("Zoom 150% at 1366×768 @calendar", () => {
  // 1366×768 at 150% browser zoom is a 911×512 CSS viewport.
  test.use({ viewport: { width: 911, height: 512 }, locale: "el-GR", contextOptions: { reducedMotion: "reduce" } });

  test.beforeEach(async () => {
    test.skip(test.info().project.name === "mobile-chromium", "Desktop only.");
    test.setTimeout(90_000);
    await resetCalendarFixtures();
  });

  test.afterAll(async () => {
    await closeCalendarFixtures();
  });

  const noSidewaysScroll = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  test("Today, Calendar (with the panel open) and Settings do not scroll sideways", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Φόρτωση", { exact: false })).toHaveCount(0, { timeout: 30_000 });
    expect(await noSidewaysScroll(page)).toBe(true);

    const grid = await openCalendar(page);
    await expect.poll(() => scrollLeft(grid)).toBeGreaterThan(0);
    expect(await noSidewaysScroll(page)).toBe(true);

    const bar = page
      .getByRole("group", { name: ROOM.alpha })
      .getByRole("button", { name: new RegExp(`^${GUEST.placedInAlpha},`) });
    const panel = page.getByRole("dialog");
    await expect(async () => {
      await bar.click();
      await expect(panel).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    expect(await noSidewaysScroll(page)).toBe(true);
    // The panel itself does not scroll sideways either.
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");

    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Ρυθμίσεις" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button").first()).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
    // The sidebar fits its own box too.
    const sidebar = page.locator("aside").first();
    expect(await sidebar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
});

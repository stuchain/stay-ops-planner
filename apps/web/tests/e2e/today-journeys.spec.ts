import { expect, test, type Page } from "@playwright/test";
import { CAL_USER, GUEST, ROOM, closeCalendarFixtures, resetCalendarFixtures } from "./calendarFixtures";

/**
 * Journey for the Today screen (P2-2): log in, land on Today, find who arrives tomorrow, open them in the
 * calendar. Uses the new-UI user and fixtures of the calendar journeys. Run with: pnpm e2e:calendar
 */

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CAL_USER.email);
  await page.getByTestId("login-password").fill(CAL_USER.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/app\/today/);
  await expect(page.getByRole("heading", { level: 1, name: "Σήμερα" })).toBeVisible({ timeout: 30_000 });
}

for (const viewport of [{ width: 1366, height: 768 }] as const) {
  test.describe(`today journeys ${viewport.width}x${viewport.height} @calendar`, () => {
    test.use({ viewport, locale: "el-GR", contextOptions: { reducedMotion: "reduce" } });

    test.beforeEach(async ({ page }) => {
      test.skip(test.info().project.name === "mobile-chromium", "Desktop layout only.");
      test.setTimeout(90_000);
      await resetCalendarFixtures();
      await login(page);
    });

    test.afterAll(async () => {
      await closeCalendarFixtures();
    });

    test("find who arrives tomorrow", async ({ page }) => {
      const tomorrow = page.getByRole("region", { name: "Επόμενες μέρες" });
      await expect(tomorrow.getByRole("heading", { name: "Αύριο" })).toBeVisible();

      const arriving = tomorrow.getByRole("link", { name: new RegExp(`^Έρχεται ${GUEST.arrivesTomorrow}`) });
      await expect(arriving).toBeVisible();
      // The stay's apartment colour chip and a sentence with the party and nights, not a code.
      await expect(arriving).toContainText(ROOM.gamma);
      await expect(arriving).toContainText("2 άτομα · 2 νύχτες");

      const leaving = tomorrow.getByRole("link", { name: new RegExp(`^Φεύγει ${GUEST.leavesTomorrow}`) }).first();
      await expect(leaving).toBeVisible();
      await expect(leaving).toContainText("Έμειναν 3 νύχτες");
      await expect(leaving).toContainText("Φεύγει");

      // A cancelled booking never shows, and tomorrow's guests are not in today's cards.
      await expect(page.getByText(GUEST.cancelledTomorrow)).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "Σήμερα", exact: true }).getByText(GUEST.arrivesTomorrow),
      ).toHaveCount(0);

      // The fixtures' tray bookings show as the one warning card at the top.
      await expect(page.getByRole("region", { name: "Χρειάζονται διαμέρισμα" })).toContainText(/κρατήσ/);

      // Clicking the guest opens the calendar with their booking selected.
      await arriving.click();
      await page.waitForURL(/\/app\/calendar\?booking=/);
      await expect(page.getByRole("dialog")).toContainText(GUEST.arrivesTomorrow, { timeout: 30_000 });
    });

    test("the sidebar's Σήμερα item is the current page", async ({ page }) => {
      await expect(page.getByRole("link", { name: "Σήμερα" })).toHaveAttribute("aria-current", "page");
    });
  });
}

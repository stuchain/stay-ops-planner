import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  CAL_USER,
  GUEST,
  ROOM,
  closeCalendarFixtures,
  occupyRoom,
  resetCalendarFixtures,
  type CalendarFixtures,
} from "./calendarFixtures";

/**
 * Journeys for the new calendar (P1B-12): placing from the tray, moving across a month boundary and undoing,
 * conflicts, pending bookings, reload, and an accessibility scan. The user has `{"newUi": true}`.
 * Run with: pnpm e2e:calendar
 */

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const ROOM_TAKEN_BY_CAROL = `Το διαμέρισμα είναι πιασμένο από ${GUEST.late} αυτές τις ημέρες.`;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(CAL_USER.email);
  await page.getByLabel("Password").fill(CAL_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\/calendar/);
  await waitForCalendar(page);
}

async function waitForCalendar(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "Ημερολόγιο" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("group", { name: ROOM.alpha })).toBeVisible({ timeout: 30_000 });
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await waitForCalendar(page);
}

const tray = (page: Page) => page.getByRole("region", { name: /Χρειάζονται διαμέρισμα/ });
const room = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const bar = (scope: Locator | Page, guest: string) => scope.getByRole("button", { name: new RegExp(`^${guest},`) });
const panel = (page: Page) => page.getByRole("dialog");
const MONTHS_EL = [
  "Ιανουάριος",
  "Φεβρουάριος",
  "Μάρτιος",
  "Απρίλιος",
  "Μάιος",
  "Ιούνιος",
  "Ιούλιος",
  "Αύγουστος",
  "Σεπτέμβριος",
  "Οκτώβριος",
  "Νοέμβριος",
  "Δεκέμβριος",
];
const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const moveButton = (page: Page, roomName: string) =>
  panel(page).getByRole("button", { name: new RegExp(`^Μετακίνηση στο ${roomName}\\.`) });

/** Clicks a bar until the panel is open: a click that lands before React has hydrated does nothing. */
async function openPanel(page: Page, target: Locator): Promise<void> {
  await expect(async () => {
    await target.click();
    await expect(panel(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

async function expectInRoom(page: Page, roomName: string, guest: string): Promise<void> {
  await expect(bar(room(page, roomName), guest)).toBeVisible();
  await expect(bar(tray(page), guest)).toHaveCount(0);
}

async function expectInTray(page: Page, guest: string): Promise<void> {
  await expect(bar(tray(page), guest)).toBeVisible();
  for (const name of Object.values(ROOM)) await expect(bar(room(page, name), guest)).toHaveCount(0);
}

/** Scrolls the calendar a month at a time until the guest's bar is inside the visible part of the grid. */
async function scrollToBar(page: Page, guest: string): Promise<void> {
  const grid = page.getByRole("region", { name: "Ημερολόγιο διαμερισμάτων" });
  const target = bar(grid, guest);
  for (let i = 0; i < 4; i++) {
    const inside = await target.evaluate((el) => {
      const view = el.closest('[role="region"]')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return box.right > view.left + 208 && box.left < view.right;
    });
    if (inside) return;
    await page.getByRole("button", { name: "Επόμενος μήνας" }).click();
    await page.waitForTimeout(150);
  }
  await expect(target).toBeVisible();
}

/** A real pointer drag: dnd-kit's PointerSensor needs 6px of movement before it picks the bar up. */
async function drag(page: Page, source: Locator, row: Locator): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  await row.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const grid = (await page.getByRole("region", { name: "Ημερολόγιο διαμερισμάτων" }).boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  // The row is as wide as the whole timeline, so aim at its sticky label cell, which is always on screen.
  const toX = grid.x + 104;
  const toY = rowBox.y + rowBox.height / 2;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 52, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(toX, toY, { steps: 25 });
  await page.mouse.move(toX + 2, toY + 1, { steps: 3 });
  await page.mouse.up();
}

for (const viewport of VIEWPORTS) {
  test.describe(`new calendar journeys ${viewport.width}x${viewport.height} @calendar`, () => {
    test.use({ viewport, locale: "el-GR", contextOptions: { reducedMotion: "reduce" } });

    let data: CalendarFixtures;

    test.beforeEach(async ({ page }) => {
      test.skip(test.info().project.name === "mobile-chromium", "Desktop layout only.");
      // The first test in a run pays for the dev server compiling the login and calendar routes.
      test.setTimeout(90_000);
      data = await resetCalendarFixtures();
      await login(page);
    });

    test.afterAll(async () => {
      await closeCalendarFixtures();
    });

    test("places a tray booking with the panel buttons", async ({ page }) => {
      // Other specs' seed data can add tray bookings of their own, so check this test's ones, not the total.
      await expect(bar(tray(page), GUEST.trayClick)).toBeVisible();
      await openPanel(page, bar(tray(page), GUEST.trayClick));

      await expect(panel(page)).toBeVisible();
      await expect(panel(page).getByRole("heading", { name: GUEST.trayClick })).toBeVisible();
      await expect(panel(page).getByRole("heading", { name: "Μετακίνηση σε" })).toBeVisible();
      await expect(moveButton(page, ROOM.alpha)).toBeEnabled();
      await moveButton(page, ROOM.alpha).click();

      await expect(toast(page, `Μετακινήθηκε στο ${ROOM.alpha}`)).toBeVisible();
      await expect(
        toast(page, `Μετακινήθηκε στο ${ROOM.alpha}`).getByRole("button", { name: "Αναίρεση" }),
      ).toBeVisible();
      await expectInRoom(page, ROOM.alpha, GUEST.trayClick);
      await expect(panel(page).getByText(ROOM.alpha, { exact: true }).first()).toBeVisible();

      await reload(page);
      await expectInRoom(page, ROOM.alpha, GUEST.trayClick);
      await expect(bar(tray(page), GUEST.trayDrag)).toBeVisible();
    });

    test("places a tray booking by dragging it onto a free row", async ({ page }) => {
      await drag(page, bar(tray(page), GUEST.trayDrag), room(page, ROOM.beta));

      await expect(toast(page, `Μετακινήθηκε στο ${ROOM.beta}`)).toBeVisible();
      await expectInRoom(page, ROOM.beta, GUEST.trayDrag);
      await expect(panel(page)).toHaveCount(0);

      await reload(page);
      await expectInRoom(page, ROOM.beta, GUEST.trayDrag);
      await expect(bar(tray(page), GUEST.trayClick)).toBeVisible();
    });

    test("moves a booking across a month boundary and undoes it", async ({ page }) => {
      const first = new Date(`${data.boundary.firstOfMonth}T00:00:00Z`);
      const monthName = MONTHS_EL[first.getUTCMonth()];
      expect(data.boundary.checkin.slice(0, 7)).not.toBe(data.boundary.checkout.slice(0, 7));

      await scrollToBar(page, GUEST.boundary);
      await expect(page.getByText(new RegExp(`${monthName} ${first.getUTCFullYear()}`)).first()).toBeVisible();
      await expectInRoom(page, ROOM.gamma, GUEST.boundary);

      await openPanel(page, bar(room(page, ROOM.gamma), GUEST.boundary));
      await expect(panel(page).getByRole("heading", { name: GUEST.boundary })).toBeVisible();
      await expect(moveButton(page, ROOM.gamma)).toBeDisabled();
      await moveButton(page, ROOM.alpha).click();

      const moved = toast(page, `Μετακινήθηκε στο ${ROOM.alpha}`);
      await expect(moved).toBeVisible();
      await expectInRoom(page, ROOM.alpha, GUEST.boundary);
      await expect(bar(room(page, ROOM.gamma), GUEST.boundary)).toHaveCount(0);

      await reload(page);
      await expectInRoom(page, ROOM.alpha, GUEST.boundary);

      // Undo in a fresh move, so the toast belongs to this page load.
      await openPanel(page, bar(room(page, ROOM.alpha), GUEST.boundary));
      await moveButton(page, ROOM.beta).click();
      const movedAgain = toast(page, `Μετακινήθηκε στο ${ROOM.beta}`);
      await expect(movedAgain).toBeVisible();
      await movedAgain.getByRole("button", { name: "Αναίρεση" }).click();

      await expect(toast(page, `Μετακινήθηκε στο ${ROOM.alpha}`)).toBeVisible();
      await expectInRoom(page, ROOM.alpha, GUEST.boundary);
      await expect(bar(room(page, ROOM.beta), GUEST.boundary)).toHaveCount(0);

      await reload(page);
      await expectInRoom(page, ROOM.alpha, GUEST.boundary);
      await expect(bar(room(page, ROOM.gamma), GUEST.boundary)).toHaveCount(0);
    });

    test("undo puts the first move back where it was", async ({ page }) => {
      await openPanel(page, bar(room(page, ROOM.gamma), GUEST.boundary));
      await moveButton(page, ROOM.alpha).click();
      const moved = toast(page, `Μετακινήθηκε στο ${ROOM.alpha}`);
      await expect(moved).toBeVisible();
      await moved.getByRole("button", { name: "Αναίρεση" }).click();

      await expect(toast(page, `Μετακινήθηκε στο ${ROOM.gamma}`)).toBeVisible();
      await expectInRoom(page, ROOM.gamma, GUEST.boundary);

      await reload(page);
      await expectInRoom(page, ROOM.gamma, GUEST.boundary);
      await expect(bar(room(page, ROOM.alpha), GUEST.boundary)).toHaveCount(0);
    });

    test("shows who is in a busy apartment and does not move a booking there", async ({ page }) => {
      await openPanel(page, bar(room(page, ROOM.beta), GUEST.moverInBeta));
      await expect(panel(page)).toBeVisible();

      const busy = moveButton(page, ROOM.alpha);
      await expect(busy).toBeDisabled();
      await expect(busy).toHaveAccessibleName(`Μετακίνηση στο ${ROOM.alpha}. Κλεισμένο: ${GUEST.placedInAlpha}`);
      await expect(room(page, ROOM.alpha)).toContainText(`Κλεισμένο: ${GUEST.placedInAlpha}`);
      await expect(moveButton(page, ROOM.gamma)).toBeEnabled();

      // Dropping on the busy row opens the panel instead of moving.
      await page.keyboard.press("Escape");
      await expect(panel(page)).toHaveCount(0);
      await drag(page, bar(room(page, ROOM.beta), GUEST.moverInBeta), room(page, ROOM.alpha));
      await expect(panel(page)).toBeVisible();
      await expect(panel(page).getByRole("heading", { name: GUEST.moverInBeta })).toBeVisible();
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
      await expectInRoom(page, ROOM.beta, GUEST.moverInBeta);

      await reload(page);
      await expectInRoom(page, ROOM.beta, GUEST.moverInBeta);
      await expectInRoom(page, ROOM.alpha, GUEST.placedInAlpha);
    });

    test("tells the person in Greek when the server says the apartment is taken", async ({ page }) => {
      await openPanel(page, bar(room(page, ROOM.beta), GUEST.moverInBeta));
      const toGamma = moveButton(page, ROOM.gamma);
      await expect(toGamma).toBeEnabled();

      // Someone else books Gamma for the same nights after the panel loaded.
      await occupyRoom("gamma", GUEST.late, 3, 3);
      await toGamma.click();

      await expect(toast(page, ROOM_TAKEN_BY_CAROL)).toBeVisible();
      await expectInRoom(page, ROOM.beta, GUEST.moverInBeta);

      await reload(page);
      await expectInRoom(page, ROOM.beta, GUEST.moverInBeta);
      await expectInRoom(page, ROOM.gamma, GUEST.late);
    });

    test("does not place a pending booking", async ({ page }) => {
      await openPanel(page, bar(tray(page), GUEST.pending));

      await expect(panel(page).getByRole("heading", { name: GUEST.pending })).toBeVisible();
      await expect(
        panel(page).getByText("Η κράτηση δεν έχει επιβεβαιωθεί ακόμα, οπότε δεν μπαίνει σε διαμέρισμα."),
      ).toBeVisible();
      await expect(panel(page).getByRole("heading", { name: "Μετακίνηση σε" })).toHaveCount(0);
      await expect(panel(page).getByRole("button", { name: /^Μετακίνηση στο/ })).toHaveCount(0);

      // It cannot be dragged either.
      await page.keyboard.press("Escape");
      await drag(page, bar(tray(page), GUEST.pending), room(page, ROOM.alpha));
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
      await expectInTray(page, GUEST.pending);

      await reload(page);
      await expectInTray(page, GUEST.pending);
    });

    test("keeps every change after a reload", async ({ page }) => {
      // Click flow.
      await openPanel(page, bar(tray(page), GUEST.trayClick));
      await moveButton(page, ROOM.alpha).click();
      await expect(toast(page, `Μετακινήθηκε στο ${ROOM.alpha}`)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel(page)).toHaveCount(0);

      // Drag flow.
      await drag(page, bar(tray(page), GUEST.trayDrag), room(page, ROOM.beta));
      await expect(toast(page, `Μετακινήθηκε στο ${ROOM.beta}`)).toBeVisible();

      // Month boundary move.
      await scrollToBar(page, GUEST.boundary);
      await openPanel(page, bar(room(page, ROOM.gamma), GUEST.boundary));
      await moveButton(page, ROOM.beta).click();
      await expect(toast(page, `Μετακινήθηκε στο ${ROOM.beta}`).first()).toBeVisible();
      await expectInRoom(page, ROOM.beta, GUEST.boundary);

      // Take one back out to the tray (back to today, where the first booking is drawn).
      await page.getByRole("button", { name: "Σήμερα" }).click();
      await expect(bar(room(page, ROOM.alpha), GUEST.trayClick)).toBeVisible();
      await openPanel(page, bar(room(page, ROOM.alpha), GUEST.trayClick));
      await panel(page).getByRole("button", { name: "Βγάλε την από το διαμέρισμα" }).click();
      await expectInTray(page, GUEST.trayClick);

      await reload(page);
      await expectInTray(page, GUEST.trayClick);
      await expectInRoom(page, ROOM.beta, GUEST.trayDrag);
      await expectInRoom(page, ROOM.beta, GUEST.boundary);
      await expectInRoom(page, ROOM.alpha, GUEST.placedInAlpha);
      await expectInTray(page, GUEST.pending);
    });

    test("has no serious accessibility violations @a11y", async ({ page }) => {
      const scan = () =>
        new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = (results: Awaited<ReturnType<typeof scan>>) =>
        results.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")) }));

      await expect(bar(room(page, ROOM.alpha), GUEST.placedInAlpha)).toBeVisible();
      expect(serious(await scan()), "calendar").toEqual([]);

      await openPanel(page, bar(room(page, ROOM.beta), GUEST.moverInBeta));
      await expect(moveButton(page, ROOM.gamma)).toBeEnabled();
      expect(serious(await scan()), "calendar with the booking panel open").toEqual([]);
    });
  });
}

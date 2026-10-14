import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addScrollFixtures,
  CAL_USER,
  closeCalendarFixtures,
  GUEST,
  ROOM,
  resetCalendarFixtures,
  SCROLL_FROM,
  SCROLL_GUEST,
} from "./calendarFixtures";

/**
 * Scrolling the calendar sideways and the stays far from today: no flicker (bars are never re-created or
 * missing while scrolling), the day header always covers the screen, past stays two years back, stays
 * without an apartment, zoom and keyboard. Run with: pnpm e2e:calendar
 */

const MONTH_DAY_WIDTH = 44;
const WEEK_DAY_WIDTH = 132;
const LABEL_WIDTH = 208;

const grid = (page: Page) => page.getByRole("region", { name: "Ημερολόγιο διαμερισμάτων" });
const room = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const pastRow = (page: Page) => page.getByRole("group", { name: "Περασμένες κρατήσεις", exact: true });
const bar = (scope: Locator | Page, guest: string) => scope.getByRole("button", { name: new RegExp(`^${guest},`) });
const panel = (page: Page) => page.getByRole("dialog");

/** The past bookings row starts folded; open it unless this browser already did. */
async function openPastRow(page: Page): Promise<void> {
  const row = page.getByTestId("past-unplaced-row");
  await expect(row).toBeVisible();
  if ((await row.getAttribute("data-open")) !== "true") await page.getByTestId("past-unplaced-toggle").click();
  await expect(row).toHaveAttribute("data-open", "true");
}

/** Today in UTC (the e2e server runs with APP_TIMEZONE=Etc/UTC). */
function utcDay(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
}

/** Column of a day: the calendar starts on the first of the month two years before this one. */
function dayColumn(offset: number): number {
  const today = utcDay(0);
  const origin = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 24, 1);
  return Math.round((utcDay(offset).getTime() - origin) / 86_400_000);
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CAL_USER.email);
  await page.getByTestId("login-password").fill(CAL_USER.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/app\/today/);
  await page.goto("/app/calendar");
  await expect(room(page, ROOM.alpha)).toBeVisible({ timeout: 30_000 });
  await expect(bar(room(page, ROOM.alpha), GUEST.placedInAlpha)).toBeVisible({ timeout: 30_000 });
}

/** Puts the given day (offset from today) at the left edge of the grid, the way a scroll would. */
async function scrollToDay(page: Page, offset: number, dayWidth = MONTH_DAY_WIDTH): Promise<void> {
  const left = Math.max(0, (dayColumn(offset) - 2) * dayWidth);
  await grid(page).evaluate((el, x) => {
    el.scrollLeft = x;
    el.dispatchEvent(new Event("scroll"));
  }, left);
}

/** Is the bar's box inside the part of the grid the person sees (right of the apartment names)? */
async function onScreen(target: Locator): Promise<boolean> {
  return target.evaluate((el, labelWidth) => {
    const view = el.closest('[role="region"]')!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return box.right > view.left + labelWidth && box.left < view.right;
  }, LABEL_WIDTH);
}

/** Wheel-scrolls the grid sideways with the mouse over it. */
async function wheel(page: Page, steps: number, dx: number): Promise<void> {
  const box = (await grid(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(dx, 0);
    await page.waitForTimeout(16);
  }
}

/** The visible month labels in the day header. */
async function visibleMonths(page: Page): Promise<string> {
  return grid(page).evaluate((el) => {
    const view = el.getBoundingClientRect();
    return [...el.querySelectorAll("span")]
      .filter((s) => /^\p{L}+ \d{4}$/u.test(s.textContent ?? ""))
      .filter((s) => {
        const r = s.getBoundingClientRect();
        return r.right > view.left + 208 && r.left < view.right;
      })
      .map((s) => s.textContent)
      .join(" | ");
  });
}

test.describe("calendar scrolling and stays far from today @calendar", () => {
  test.use({ viewport: { width: 1366, height: 768 }, locale: "el-GR", contextOptions: { reducedMotion: "reduce" } });

  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name === "mobile-chromium", "Desktop layout only.");
    test.setTimeout(120_000);
    await resetCalendarFixtures();
    await addScrollFixtures();
    await login(page);
  });

  test.afterAll(async () => {
    await closeCalendarFixtures();
  });

  test("keeps the same bars on screen while scrolling sideways (no flicker)", async ({ page }) => {
    await scrollToDay(page, SCROLL_FROM.longStay + 20);
    const lena = bar(room(page, ROOM.alpha), SCROLL_GUEST.longStay);
    await expect(lena).toBeVisible();
    await lena.evaluate((el) => el.setAttribute("data-kept", "1"));

    // Back and forth over a few weeks, past several redraw steps, with the bar leaving the screen and coming back.
    await wheel(page, 30, 80);
    await wheel(page, 30, -80);
    await wheel(page, 20, -60);
    await wheel(page, 20, 60);

    // The very same element is still there: nothing was thrown away and drawn again while scrolling.
    await expect(room(page, ROOM.alpha).locator('[data-kept="1"]')).toHaveCount(1);
    expect(await onScreen(lena)).toBe(true);
  });

  test("never shows an empty edge or loses a bar during a long fast scroll", async ({ page }) => {
    await scrollToDay(page, SCROLL_FROM.longStay - 10);
    await expect(bar(room(page, ROOM.alpha), SCROLL_GUEST.longStay)).toBeVisible();

    const problems = await grid(page).evaluate(
      async (el, { labelWidth, guest }) => {
        const out: string[] = [];
        for (let frame = 0; frame < 90; frame++) {
          el.scrollLeft += 70;
          await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
          const view = el.getBoundingClientRect();
          // The day header must reach both edges of what is on screen.
          const cells = [...el.querySelectorAll<HTMLElement>(".top-8")].map((c) => c.getBoundingClientRect());
          const left = Math.min(...cells.map((c) => c.left));
          const right = Math.max(...cells.map((c) => c.right));
          if (left > view.left + labelWidth + 1 || right < view.right - 1) out.push(`frame ${frame}: header gap`);
          // The 60-night stay must be in the page every frame while its dates are on screen.
          const bars = [...el.querySelectorAll<HTMLElement>("button[aria-label]")].filter((b) =>
            b.getAttribute("aria-label")!.startsWith(`${guest},`),
          );
          if (bars.length !== 1) out.push(`frame ${frame}: ${bars.length} bars for the long stay`);
        }
        return out;
      },
      { labelWidth: LABEL_WIDTH, guest: SCROLL_GUEST.longStay },
    );
    expect(problems).toEqual([]);
  });

  test("shows a stay from twenty months ago and one sixteen months ahead", async ({ page }) => {
    await scrollToDay(page, SCROLL_FROM.twentyMonthsAgo - 3);
    const old = bar(room(page, ROOM.beta), SCROLL_GUEST.twentyMonthsAgo);
    await expect(old).toBeVisible({ timeout: 15_000 });
    expect(await onScreen(old)).toBe(true);

    await scrollToDay(page, SCROLL_FROM.farAhead - 3);
    const future = bar(room(page, ROOM.beta), SCROLL_GUEST.farAhead);
    await expect(future).toBeVisible({ timeout: 15_000 });
    expect(await onScreen(future)).toBe(true);
  });

  test("keeps the guest's name in view when a long stay starts before the screen", async ({ page }) => {
    await scrollToDay(page, SCROLL_FROM.longStay + 20);
    const lena = bar(room(page, ROOM.alpha), SCROLL_GUEST.longStay);
    await expect(lena).toBeVisible();
    const name = lena.getByText(SCROLL_GUEST.longStay, { exact: true });
    await expect
      .poll(async () => {
        const view = (await grid(page).boundingBox())!;
        const box = (await name.boundingBox())!;
        return box.x >= view.x + LABEL_WIDTH && box.x < view.x + LABEL_WIDTH + 80;
      })
      .toBe(true);
  });

  test("has far months ready before scrolling there, so rows never fill in late", async ({ page }) => {
    // Once the calendar settles every month is loaded; then the server is cut off and far stays must still show.
    await page.waitForLoadState("networkidle");
    await page.route("**/api/trpc/**", (route) =>
      route.request().url().includes("calendar.range") ? route.abort() : route.fallback(),
    );
    await scrollToDay(page, SCROLL_FROM.farAhead - 3);
    await expect(bar(room(page, ROOM.beta), SCROLL_GUEST.farAhead)).toBeVisible({ timeout: 2_000 });
    await scrollToDay(page, SCROLL_FROM.twentyMonthsAgo - 3);
    await expect(bar(room(page, ROOM.beta), SCROLL_GUEST.twentyMonthsAgo)).toBeVisible({ timeout: 2_000 });
  });

  test("lists finished stays without an apartment under the apartments, one under the other", async ({ page }) => {
    await scrollToDay(page, SCROLL_FROM.pastUnplacedA - 3);
    await openPastRow(page);
    const row = pastRow(page);
    await expect(row).toBeVisible();
    await expect(row.getByText("Δεν γράφτηκε το διαμέρισμα. Δεν χρειάζεται κάτι.")).toBeVisible();
    const a = bar(row, SCROLL_GUEST.pastUnplacedA);
    const b = bar(row, SCROLL_GUEST.pastUnplacedB);
    await expect(a).toBeVisible();
    await expect(b).toBeVisible();
    // They overlap in time, so they sit on separate lanes and do not cover each other.
    const boxA = (await a.boundingBox())!;
    const boxB = (await b.boundingBox())!;
    expect(boxA.y + boxA.height <= boxB.y || boxB.y + boxB.height <= boxA.y).toBe(true);
    // Not in the "needs an apartment" list: that is only for stays still to come.
    await expect(
      bar(page.getByRole("region", { name: /Χρειάζονται διαμέρισμα/ }), SCROLL_GUEST.pastUnplacedA),
    ).toHaveCount(0);
  });

  test("records the apartment a finished stay used, then keeps it there", async ({ page }) => {
    await scrollToDay(page, SCROLL_FROM.pastUnplacedA - 3);
    await openPastRow(page);
    await expect(async () => {
      await bar(pastRow(page), SCROLL_GUEST.pastUnplacedA).click();
      await expect(panel(page)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await expect(panel(page).getByRole("heading", { name: "Σε ποιο διαμέρισμα έμεινε;" })).toBeVisible();
    await panel(page)
      .getByRole("button", { name: new RegExp(`^Μετακίνηση στο ${ROOM.gamma}\\.`) })
      .click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: `Μετακινήθηκε στο ${ROOM.gamma}` }),
    ).toBeVisible();
    await expect(bar(room(page, ROOM.gamma), SCROLL_GUEST.pastUnplacedA)).toBeVisible();
    await expect(bar(pastRow(page), SCROLL_GUEST.pastUnplacedA)).toHaveCount(0);

    // Now that it has an apartment it is a finished stay like any other: no more moving.
    await expect(panel(page).getByText(/Η διαμονή τελείωσε την .*, οπότε δεν μετακινείται\./)).toBeVisible();
    await expect(panel(page).getByRole("button", { name: /^Μετακίνηση στο / })).toHaveCount(0);

    await page.reload();
    await scrollToDay(page, SCROLL_FROM.pastUnplacedA - 3);
    await expect(bar(room(page, ROOM.gamma), SCROLL_GUEST.pastUnplacedA)).toBeVisible({ timeout: 30_000 });
  });

  test("a finished stay with an apartment cannot be moved", async ({ page }) => {
    await scrollToDay(page, SCROLL_FROM.pastPlaced - 3);
    await expect(async () => {
      await bar(room(page, ROOM.beta), SCROLL_GUEST.pastPlaced).click();
      await expect(panel(page)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(panel(page).getByText(/Η διαμονή τελείωσε την .*, οπότε δεν μετακινείται\./)).toBeVisible();
    await expect(panel(page).getByRole("button", { name: /^Μετακίνηση στο / })).toHaveCount(0);
  });

  test("never shows a cancelled booking", async ({ page }) => {
    await expect(page.getByRole("button", { name: new RegExp(`^${GUEST.cancelledTomorrow},`) })).toHaveCount(0);
    await wheel(page, 10, 60);
    await expect(page.getByRole("button", { name: new RegExp(`^${GUEST.cancelledTomorrow},`) })).toHaveCount(0);
  });

  test("keeps the same first day when switching between month and week", async ({ page }) => {
    await scrollToDay(page, SCROLL_FROM.longStay + 5);
    const before = await grid(page).evaluate((el, w) => Math.floor(el.scrollLeft / w), MONTH_DAY_WIDTH);
    await page.getByRole("radio", { name: "Εβδομάδα", exact: true }).click();
    await expect
      .poll(() => grid(page).evaluate((el, w) => Math.floor(el.scrollLeft / w), WEEK_DAY_WIDTH))
      .toBeGreaterThanOrEqual(before);
    const week = await grid(page).evaluate((el, w) => Math.floor(el.scrollLeft / w), WEEK_DAY_WIDTH);
    expect(Math.abs(week - before)).toBeLessThanOrEqual(3);
    await expect(bar(room(page, ROOM.alpha), SCROLL_GUEST.longStay)).toBeVisible();

    await page.getByRole("radio", { name: "Μήνας", exact: true }).click();
    await expect
      .poll(async () =>
        Math.abs((await grid(page).evaluate((el, w) => Math.floor(el.scrollLeft / w), MONTH_DAY_WIDTH)) - before),
      )
      .toBeLessThanOrEqual(3);
  });

  test("moves a month with the arrows and the keyboard, and comes back with Σήμερα and T", async ({ page }) => {
    const months = await visibleMonths(page);
    await page.getByRole("button", { name: "Επόμενος μήνας" }).click();
    await expect.poll(() => visibleMonths(page)).not.toBe(months);
    await page.getByRole("button", { name: "Σήμερα", exact: true }).click();
    await expect.poll(() => visibleMonths(page)).toBe(months);

    await grid(page).focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => visibleMonths(page)).not.toBe(months);
    await page.keyboard.press("t");
    await expect.poll(() => visibleMonths(page)).toBe(months);
    await expect(bar(room(page, ROOM.alpha), GUEST.placedInAlpha)).toBeVisible();
  });

  test("stops cleanly at both ends of the calendar", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await grid(page).evaluate((el) => {
      el.scrollLeft = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(() => visibleMonths(page)).toMatch(/\d{4}/);
    const first = utcDay(0);
    const start = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 24, 1));
    expect(await visibleMonths(page)).toContain(String(start.getUTCFullYear()));

    await grid(page).evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(() => visibleMonths(page)).toMatch(/\d{4}/);
    await wheel(page, 5, 200);
    expect(errors).toEqual([]);
  });
});

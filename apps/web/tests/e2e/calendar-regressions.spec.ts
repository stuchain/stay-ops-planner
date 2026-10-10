import { expect, test, type Locator, type Page } from "@playwright/test";
import { e2eCredentials, gotoCalendarAndWaitReady, loginAsStaff, reseedE2EFixtures } from "./helpers";

/**
 * Regression journeys for the calendar (Phase 0). They use real pointer drags (dnd-kit PointerSensor,
 * activation distance 6px) in the 2-month view, so the drop-target behaviour is what is under test.
 * Every move is checked twice: on screen right after the drop (before any reload) and after `page.reload()`.
 */

const BAR = '[data-testid^="ops-booking-card-"]';

test.use({ viewport: { width: 2000, height: 1100 } });
test.setTimeout(60_000);

function lane(page: Page, code: "E2E-A" | "E2E-B" | "E2E-C"): Locator {
  return page.getByTestId(`ops-room-lane-${code}`);
}

function barIn(page: Page, code: "E2E-A" | "E2E-B" | "E2E-C", guest: string): Locator {
  return lane(page, code).locator(BAR).filter({ hasText: guest });
}

async function expectBarOnlyIn(
  page: Page,
  guest: string,
  where: "E2E-A" | "E2E-B" | "E2E-C",
): Promise<void> {
  await expect(barIn(page, where, guest)).toHaveCount(1);
  for (const other of ["E2E-A", "E2E-B", "E2E-C"] as const) {
    if (other !== where) await expect(barIn(page, other, guest)).toHaveCount(0);
  }
}

/** The 2-month view in the current month, so a stay that crosses the month end is one continuous bar. */
async function openTwoMonthCalendar(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const n = new Date();
      window.localStorage.setItem(
        "ops.calendar.month",
        `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`,
      );
      window.localStorage.setItem("ops.calendar.displayMonths", "2");
    } catch {
      /* storage unavailable: the test then fails loudly on the missing lanes */
    }
  });
  await loginAsStaff(page);
  await gotoCalendarAndWaitReady(page);
  await waitForGrid(page);
}

async function waitForGrid(page: Page): Promise<void> {
  await expect(lane(page, "E2E-A")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(BAR).first()).toBeVisible({ timeout: 20_000 });
}

async function reloadAndWaitForGrid(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator('input[type="month"]').first()).toBeVisible({ timeout: 15_000 });
  await waitForGrid(page);
}

/** Counts finished move requests so a test can wait until the server has answered them all. */
function trackMoves(page: Page) {
  const done: number[] = [];
  page.on("response", (res) => {
    const req = res.request();
    if (
      req.method() !== "GET" &&
      /\/api\/assignments(\/|$)/.test(new URL(res.url()).pathname)
    ) {
      done.push(res.status());
    }
  });
  return {
    statuses: done,
    async waitFor(count: number) {
      await expect.poll(() => done.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(count);
    },
  };
}

type DropOn = "row" | "name";

/**
 * Real pointer drag of a booking bar onto an apartment row.
 * `row` keeps the pointer in the same day column (inside the row's day grid); `name` drops on the apartment name cell.
 */
async function dragBarToLane(
  page: Page,
  bar: Locator,
  targetLane: Locator,
  dropOn: DropOn = "row",
): Promise<void> {
  await bar.scrollIntoViewIfNeeded();
  await targetLane.scrollIntoViewIfNeeded();
  const from = await bar.boundingBox();
  if (!from) throw new Error("booking bar has no box");
  const sx = from.x + Math.min(from.width / 2, 80);
  const sy = from.y + from.height / 2;

  let tx: number;
  let ty: number;
  if (dropOn === "name") {
    const cell = await targetLane.locator(".ops-timeline-room-label").boundingBox();
    if (!cell) throw new Error("apartment name cell has no box");
    tx = cell.x + cell.width / 2;
    ty = cell.y + cell.height / 2;
  } else {
    const row = await targetLane.locator(".ops-timeline-track").boundingBox();
    if (!row) throw new Error("apartment row has no box");
    tx = sx;
    ty = row.y + Math.min(row.height / 2, 18);
  }

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // Past the 6px activation distance first, then travel to the target in small steps.
  await page.mouse.move(sx + 10, sy + 2, { steps: 3 });
  await page.mouse.move(tx, ty, { steps: 25 });
  await page.waitForTimeout(80);
  await page.mouse.up();
}

async function expectNoToast(page: Page): Promise<void> {
  await expect(page.locator(".ops-toast")).toHaveCount(0);
}

/** Same selection the queue uses, independent of display language. */
async function selectRoomInQueue(select: Locator, code: string, name: string): Promise<void> {
  const value = await select.locator("option").evaluateAll(
    (options, [c, n]) => {
      const match = options.find((o) => {
        const text = o.textContent ?? "";
        return text.includes(c as string) || text.includes(n as string);
      }) as HTMLOptionElement | undefined;
      return match?.value ?? null;
    },
    [code, name],
  );
  expect(value, `room ${code} missing from the assignment dropdown`).toBeTruthy();
  await select.selectOption(value as string);
}

test.describe("calendar regressions @calendar", () => {
  // `next dev` compiles each route on first use; do that before the timed journeys so a cold
  // server (first run, CI) cannot slow a drag down mid-gesture.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    if (test.info().project.name === "mobile-chromium" || !e2eCredentials()) return;
    const page = await browser.newPage({ baseURL: test.info().project.use.baseURL });
    try {
      await loginAsStaff(page);
      await gotoCalendarAndWaitReady(page);
      await page.evaluate(async () => {
        const json = { "content-type": "application/json" };
        await fetch("/api/assignments", { method: "POST", headers: json, body: "{}" });
        await fetch("/api/assignments/warmup/reassign", { method: "PATCH", headers: json, body: "{}" });
        await fetch("/api/assignments/warmup/unassign", { method: "POST", headers: json, body: "{}" });
        await fetch("/api/bookings/overview?month=2000-01");
      });
      await page.waitForTimeout(1_500);
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async () => {
    test.skip(
      test.info().project.name === "mobile-chromium",
      "Pointer drags are desktop-only; mobile has its own quick-assign spec.",
    );
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await reseedE2EFixtures();
  });

  test("move a stay across the month boundary and back", async ({ page }) => {
    await openTwoMonthCalendar(page);
    const moves = trackMoves(page);
    await expect(barIn(page, "E2E-A", "E2E Boundary")).toHaveCount(1);

    await dragBarToLane(page, barIn(page, "E2E-A", "E2E Boundary"), lane(page, "E2E-B"));
    await expectBarOnlyIn(page, "E2E Boundary", "E2E-B");
    await moves.waitFor(1);
    await expectNoToast(page);
    await expectBarOnlyIn(page, "E2E Boundary", "E2E-B");

    await reloadAndWaitForGrid(page);
    await expectBarOnlyIn(page, "E2E Boundary", "E2E-B");

    await dragBarToLane(page, barIn(page, "E2E-B", "E2E Boundary"), lane(page, "E2E-A"));
    await expectBarOnlyIn(page, "E2E Boundary", "E2E-A");
    await moves.waitFor(2);
    await expectNoToast(page);

    await reloadAndWaitForGrid(page);
    await expectBarOnlyIn(page, "E2E Boundary", "E2E-A");
    expect(moves.statuses.every((s) => s < 300)).toBe(true);
  });

  test("two quick moves of two different bookings", async ({ page }) => {
    await openTwoMonthCalendar(page);
    const moves = trackMoves(page);
    // Keep the server slow so the second drag starts while the first move is still unanswered.
    await page.route(/\/api\/assignments\/[^/]+\/reassign/, async (route) => {
      await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });

    await dragBarToLane(page, barIn(page, "E2E-A", "E2E Alpha"), lane(page, "E2E-B"));
    await expectBarOnlyIn(page, "E2E Alpha", "E2E-B");
    await dragBarToLane(page, barIn(page, "E2E-B", "E2E Bravo"), lane(page, "E2E-A"));
    await expectBarOnlyIn(page, "E2E Bravo", "E2E-A");
    // The first move must not have been undone by the second one.
    await expectBarOnlyIn(page, "E2E Alpha", "E2E-B");

    await moves.waitFor(2);
    await expectNoToast(page);
    await expectBarOnlyIn(page, "E2E Alpha", "E2E-B");
    await expectBarOnlyIn(page, "E2E Bravo", "E2E-A");

    await reloadAndWaitForGrid(page);
    await expectBarOnlyIn(page, "E2E Alpha", "E2E-B");
    await expectBarOnlyIn(page, "E2E Bravo", "E2E-A");
  });

  test("the same booking moved twice in a row", async ({ page }) => {
    await openTwoMonthCalendar(page);
    const moves = trackMoves(page);

    await dragBarToLane(page, barIn(page, "E2E-A", "E2E Alpha"), lane(page, "E2E-B"));
    await expectBarOnlyIn(page, "E2E Alpha", "E2E-B");
    // Straight away, without waiting for the first answer or reloading.
    await dragBarToLane(page, barIn(page, "E2E-B", "E2E Alpha"), lane(page, "E2E-C"));
    await expectBarOnlyIn(page, "E2E Alpha", "E2E-C");

    await moves.waitFor(2);
    await expectNoToast(page);
    await expectBarOnlyIn(page, "E2E Alpha", "E2E-C");
    expect(moves.statuses.every((s) => s < 300)).toBe(true);

    await reloadAndWaitForGrid(page);
    await expectBarOnlyIn(page, "E2E Alpha", "E2E-C");
  });

  test("drop on the apartment name cell", async ({ page }) => {
    await openTwoMonthCalendar(page);
    const moves = trackMoves(page);

    await dragBarToLane(page, barIn(page, "E2E-A", "E2E Alpha"), lane(page, "E2E-C"), "name");
    await expectBarOnlyIn(page, "E2E Alpha", "E2E-C");
    await moves.waitFor(1);
    await expectNoToast(page);
    await expectBarOnlyIn(page, "E2E Alpha", "E2E-C");

    await reloadAndWaitForGrid(page);
    await expectBarOnlyIn(page, "E2E Alpha", "E2E-C");
  });

  test("assign from Needs assignment, then move again immediately", async ({ page }) => {
    await openTwoMonthCalendar(page);
    const moves = trackMoves(page);

    const card = page.locator(".ops-needs-card").filter({ hasText: "E2E Echo" }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await selectRoomInQueue(card.getByLabel(/Apartment for booking/), "E2E-A", "E2E Room A");
    await card.getByRole("button", { name: /^Assign$/ }).click();

    // As soon as the bar shows in the apartment, drag it on without waiting for anything else.
    const placed = barIn(page, "E2E-A", "E2E Echo");
    await expect(placed).toHaveCount(1, { timeout: 20_000 });
    await dragBarToLane(page, placed, lane(page, "E2E-B"));
    await expectBarOnlyIn(page, "E2E Echo", "E2E-B");

    await moves.waitFor(2);
    await expectNoToast(page);
    await expectBarOnlyIn(page, "E2E Echo", "E2E-B");
    await expect(page.locator(".ops-needs-card").filter({ hasText: "E2E Echo" })).toHaveCount(0);
    expect(moves.statuses.every((s) => s < 300)).toBe(true);

    await reloadAndWaitForGrid(page);
    await expectBarOnlyIn(page, "E2E Echo", "E2E-B");
    await expect(page.locator(".ops-needs-card").filter({ hasText: "E2E Echo" })).toHaveCount(0);
  });
});

import { expect, test, type Locator, type Page } from "@playwright/test";
import { e2eCredentials, gotoCalendarAndWaitReady, loginAsStaff, reseedE2EFixtures } from "./helpers";

/** Desktop path: dnd-kit + Playwright `dragTo` is flaky on Windows headless; queue uses the same mutation as drag. */
async function selectE2ERoomA(select: Locator): Promise<void> {
  const targetValue = await select.locator("option").evaluateAll((options) => {
    const match = options.find((option) => {
      const text = `${option.textContent ?? ""} ${(option as HTMLOptionElement).label ?? ""}`;
      return text.includes("E2E Room A") || text.includes("E2E-A");
    }) as HTMLOptionElement | undefined;
    return match?.value ?? null;
  });
  expect(targetValue, "E2E room A option missing from assignment dropdown").toBeTruthy();
  await select.selectOption(targetValue as string);
}

async function assignE2EUnassignedToRoomA(page: Page): Promise<void> {
  const row = page.locator(".ops-needs-card").filter({ hasText: "E2E Unassigned" }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const roomSelect = row.getByLabel(/Apartment for booking/);
  await selectE2ERoomA(roomSelect);
  await row.getByRole("button", { name: /^Assign$/ }).click();
  await expect(page.getByTestId("ops-room-lane-E2E-A").getByText("E2E Unassigned")).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("calendar allocation", () => {
  test.beforeEach(() => {
    test.skip(
      test.info().project.name === "mobile-chromium",
      "Desktop-only coverage here; mobile path has dedicated quick-assign spec.",
    );
    reseedE2EFixtures();
  });

  test("assign unassigned booking to E2E-A via queue when data exists", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await gotoCalendarAndWaitReady(page);
    test.skip((await page.getByTestId("ops-room-lane-E2E-A").count()) < 1, "E2E rooms missing (seed:e2e).");

    await assignE2EUnassignedToRoomA(page);
  });

  test("reassign into overlapping stay returns CONFLICT_ASSIGNMENT", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await gotoCalendarAndWaitReady(page);
    const monthYm = await page.getByLabel("Select month").inputValue();
    expect(monthYm).toMatch(/^\d{4}-\d{2}$/);

    test.skip((await page.getByTestId("ops-room-lane-E2E-A").count()) < 1, "E2E-A lane missing (seed:e2e).");

    await assignE2EUnassignedToRoomA(page);

    /** Same PATCH the calendar uses on drop; Playwright dragTo does not reliably fire dnd-kit on CI. */
    const result = await page.evaluate(async (ym: string) => {
      const cal = await fetch(`/api/calendar/month?month=${encodeURIComponent(ym)}`, {
        credentials: "include",
      });
      if (!cal.ok) {
        return { step: "calendar" as const, status: cal.status };
      }
      const body = (await cal.json()) as {
        data?: {
          rooms: { id: string; code: string | null }[];
          items: { kind: string; guestName?: string; assignmentId?: string | null; assignmentVersion?: number | null }[];
        };
      };
      const data = body.data;
      if (!data) return { step: "calendar_json" as const };
      const bravo = data.items.find((i) => i.kind === "booking" && i.guestName === "E2E Bravo");
      const roomA = data.rooms.find((r) => r.code === "E2E-A");
      if (!bravo?.assignmentId || bravo.assignmentVersion == null || !roomA) {
        return { step: "fixtures" as const };
      }
      const res = await fetch(`/api/assignments/${encodeURIComponent(bravo.assignmentId)}/reassign`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomId: roomA.id, expectedVersion: bravo.assignmentVersion }),
      });
      const j = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      return { step: "reassign" as const, status: res.status, code: j?.error?.code ?? null };
    }, monthYm);

    expect(result).toEqual({
      step: "reassign",
      status: 409,
      code: "CONFLICT_ASSIGNMENT",
    });
  });
});

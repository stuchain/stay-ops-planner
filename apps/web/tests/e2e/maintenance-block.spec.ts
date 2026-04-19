import { expect, test } from "@playwright/test";
import { e2eCredentials, loginAsStaff, reseedE2EFixtures } from "./helpers";

test.describe("maintenance blocks", () => {
  test.beforeEach(() => {
    reseedE2EFixtures();
  });

  test("open edit on seeded block and cancel", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title")).toBeVisible();
    test.skip((await page.getByTestId("ops-room-lane-E2E-A").count()) < 1, "Run seed:e2e for E2E-A lane.");

    const chip = page.getByTestId("ops-room-lane-E2E-A").locator('[data-testid^="ops-block-chip-"]').first();
    test.skip((await chip.count()) < 1, "Block chips are not rendered on desktop timeline view.");
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit maintenance block" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Edit maintenance block" })).not.toBeVisible();
  });

  test("delete seeded maintenance block after confirm", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title")).toBeVisible();
    test.skip((await page.getByTestId("ops-room-lane-E2E-A").count()) < 1, "Run seed:e2e for E2E-A lane.");

    const chip = page.getByTestId("ops-room-lane-E2E-A").locator('[data-testid^="ops-block-chip-"]').first();
    test.skip((await chip.count()) < 1, "Block chips are not rendered on desktop timeline view.");
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit maintenance block" })).toBeVisible();

    page.once("dialog", (d) => {
      expect(d.message()).toContain("Delete this maintenance block");
      void d.accept();
    });
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name: "Edit maintenance block" })).not.toBeVisible();
    await expect(
      page.getByTestId("ops-room-lane-E2E-A").locator('[data-testid^="ops-block-chip-"]'),
    ).toHaveCount(0, { timeout: 15_000 });
  });

  test("overlap error when creating invalid block via API", async ({ page }) => {
    test.skip(!e2eCredentials(), "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    await loginAsStaff(page);
    await page.goto("/app/calendar");
    await expect(page.locator(".ops-month-title, .ops-month-title-inline").first()).toBeVisible();
    test.skip((await page.getByTestId("ops-room-lane-E2E-A").count()) < 1, "Run seed:e2e for overlap block on E2E-A.");
    const ym = await page.getByLabel("Select month").inputValue();
    test.skip(!ym || !/^\d{4}-\d{2}$/.test(ym), "Could not read calendar month from UI.");

    const err = await page.evaluate(async (monthYm: string) => {
      const cal = await fetch(`/api/calendar/month?month=${encodeURIComponent(monthYm)}`, {
        credentials: "include",
      });
      if (!cal.ok) return { ok: false as const };
      const body = (await cal.json()) as {
        data?: { rooms: { id: string; code: string | null }[] };
      };
      const roomA = body.data?.rooms.find((r) => r.code === "E2E-A");
      if (!roomA) return { ok: false as const };
      const res = await fetch("/api/blocks", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomId: roomA.id,
          startDate: `${monthYm}-10`,
          endDate: `${monthYm}-12`,
        }),
      });
      const j = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      return { ok: true as const, status: res.status, code: j?.error?.code ?? null };
    }, ym);
    expect(err.ok).toBe(true);
    expect(err.status).toBeGreaterThanOrEqual(400);
    expect(err.code).toBeTruthy();
  });
});

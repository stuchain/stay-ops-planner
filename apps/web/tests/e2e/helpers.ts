import { execSync } from "node:child_process";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

/** Default DB URL must match `playwright.config.ts` `webServerEnv.DATABASE_URL` so reseed hits the same Postgres schema as Next.js. */
const DEFAULT_E2E_DATABASE_URL =
  "postgresql://stayops:stayops@127.0.0.1:5432/stayops?schema=e2e";

/** Re-applies `packages/db` E2E fixtures (run from repo root via `pnpm --filter @stay-ops/web test:e2e`, cwd is `apps/web`). */
export async function reseedE2EFixtures(): Promise<void> {
  const repoRoot = path.join(process.cwd(), "../..");
  try {
    execSync("corepack pnpm --filter @stay-ops/db seed:e2e", {
      cwd: repoRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL,
      },
    });
  } catch (error) {
    throw new Error(`E2E fixture reseed failed. Verify DATABASE_URL and db seed state. Cause: ${String(error)}`);
  }
}

/** Must match a seeded user (e.g. BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD). */
export function e2eCredentials(): { email: string; password: string } | null {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

export async function loginAsStaff(page: Page): Promise<void> {
  const c = e2eCredentials();
  if (!c) {
    throw new Error("Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD for E2E login.");
  }
  await page.goto("/login");
  await page.getByTestId("login-email").fill(c.email);
  await page.getByTestId("login-password").fill(c.password);
  await page.getByTestId("login-submit").click();
  // Login lands on Today. Waiting only for the URL (not the full page load) keeps the first, compile-heavy
  // dev-server run inside the test timeout.
  await page.waitForURL(/\/app\/today/, { waitUntil: "commit", timeout: 120_000 });
}

/** Heading names, in Greek or English: the seeded E2E admin's language is not fixed. */
export const TODAY_HEADING = /^(Σήμερα|Today)$/;
export const CALENDAR_HEADING = /^(Ημερολόγιο|Calendar)$/;
export const SETTINGS_HEADING = /^(Ρυθμίσεις|Settings)$/;

/** Opens the calendar and waits for its heading. */
export async function gotoCalendarAndWaitReady(page: Page): Promise<void> {
  await page.goto("/app/calendar");
  await expect(page.getByRole("heading", { level: 1, name: CALENDAR_HEADING })).toBeVisible({ timeout: 30_000 });
}

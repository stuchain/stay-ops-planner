import { execSync } from "node:child_process";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import Redis from "ioredis";

/** Default DB URL must match `playwright.config.ts` `webServerEnv.DATABASE_URL` so reseed hits the same Postgres schema as Next.js. */
const DEFAULT_E2E_DATABASE_URL =
  "postgresql://stayops:stayops@127.0.0.1:5432/stayops?schema=e2e";

async function deleteCalendarMonthCacheKeys(redisUrl: string): Promise<void> {
  const r = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
  try {
    let cursor = "0";
    do {
      const [next, keys] = await r.scan(cursor, "MATCH", "cal:month:v1:*", "COUNT", "200");
      cursor = next;
      if (keys.length > 0) {
        await r.del(...keys);
      }
    } while (cursor !== "0");
  } finally {
    await r.quit();
  }
}

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
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    await deleteCalendarMonthCacheKeys(redisUrl);
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
  await page.getByLabel("Email").fill(c.email);
  await page.getByLabel("Password").fill(c.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\/calendar/);
}

/** Opens calendar route and waits for stable controls to render across desktop/mobile layouts. */
export async function gotoCalendarAndWaitReady(page: Page): Promise<void> {
  await page.goto("/app/calendar");
  await expect(page.locator('input[type="month"]').first()).toBeVisible({ timeout: 15_000 });
}

import { execSync } from "node:child_process";
import path from "node:path";
import type { Page } from "@playwright/test";

/** Re-applies `packages/db` E2E fixtures (run from repo root via `pnpm --filter @stay-ops/web test:e2e`, cwd is `apps/web`). */
export function reseedE2EFixtures(): void {
  const repoRoot = path.join(process.cwd(), "../..");
  execSync("npx pnpm --filter @stay-ops/db seed:e2e", {
    cwd: repoRoot,
    stdio: "pipe",
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://stayops:stayops@127.0.0.1:5432/stayops",
    },
  });
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

import type { Page } from "@playwright/test";

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

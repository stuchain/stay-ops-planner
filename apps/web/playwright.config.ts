import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

/** Ensures `next dev` uses the same DB/Redis as migrate/seed; Next does not override vars already set in the process env. */
const webServerEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  ),
  DATABASE_URL:
    process.env.DATABASE_URL ?? "postgresql://stayops:stayops@127.0.0.1:5432/stayops",
  REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  SESSION_SECRET:
    process.env.SESSION_SECRET ?? "local-dev-session-secret-32-chars-minimum!!",
  APP_TIMEZONE: process.env.APP_TIMEZONE ?? "Etc/UTC",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        command: "pnpm exec next dev -p 3000",
        url: `${baseURL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
        env: webServerEnv,
      },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});

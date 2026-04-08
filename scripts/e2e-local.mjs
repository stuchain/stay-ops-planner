#!/usr/bin/env node
/**
 * One-shot local E2E: Docker Postgres/Redis → migrate → seed → seed:e2e → Playwright.
 *
 * Default credentials match `.github/workflows/e2e.yml` (disposable local/CI only).
 * Override with env: DATABASE_URL, BOOTSTRAP_ADMIN_*, E2E_ADMIN_*, SESSION_SECRET, etc.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "e2e-admin@stayops.local";
const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "E2E_Test_Password_12+";

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://stayops:stayops@127.0.0.1:5432/stayops?schema=e2e",
  REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  SESSION_SECRET:
    process.env.SESSION_SECRET ?? "local-e2e-session-secret-at-least-32-chars-long",
  APP_TIMEZONE: process.env.APP_TIMEZONE ?? "Etc/UTC",
  BOOTSTRAP_ADMIN_EMAIL: bootstrapEmail,
  BOOTSTRAP_ADMIN_PASSWORD: bootstrapPassword,
  E2E_ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL ?? bootstrapEmail,
  E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD ?? bootstrapPassword,
};

const win32 = process.platform === "win32";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: root,
    env,
    /** Windows: resolve `pnpm`/`npx` `.cmd` shims (spawnSync would otherwise ENOENT). */
    shell: win32,
    ...opts,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/**
 * Dedicated port + own server: avoids binding to 3000 (often used by `pnpm dev`) and
 * `reuseExistingServer` attaching to a process that then exits mid-run.
 * Playwright reads PLAYWRIGHT_DEV_PORT / PLAYWRIGHT_BASE_URL / PLAYWRIGHT_FORCE_OWN_SERVER.
 */
function envForPlaywright() {
  const e = { ...env };
  delete e.CI;
  e.PLAYWRIGHT_DEV_PORT = "3005";
  e.PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3005";
  e.PLAYWRIGHT_FORCE_OWN_SERVER = "1";
  return e;
}

async function waitForPostgres() {
  for (let i = 0; i < 45; i++) {
    const r = spawnSync(
      "docker",
      ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "stayops", "-d", "stayops"],
      { cwd: root, encoding: "utf-8" },
    );
    if (r.status === 0) return;
    await delay(1000);
  }
  console.error("Postgres did not become ready in time. Is Docker running?");
  process.exit(1);
}

async function main() {
  console.log("Starting postgres + redis (docker compose)…");
  run("docker", ["compose", "up", "-d", "postgres", "redis"]);

  await waitForPostgres();
  console.log("Postgres is ready.");

  console.log("Migrating and seeding (bootstrap admin + E2E fixtures)…");
  run("corepack", ["pnpm", "--filter", "@stay-ops/db", "exec", "prisma", "migrate", "deploy"]);
  run("corepack", ["pnpm", "--filter", "@stay-ops/db", "seed"]);
  run("corepack", ["pnpm", "--filter", "@stay-ops/db", "seed:e2e"]);

  console.log("Running Playwright…");
  try {
    run("corepack", ["pnpm", "--filter", "@stay-ops/web", "test:e2e"], { env: envForPlaywright() });
  } finally {
    console.log("Running cleanup:e2e (R1/E2E rooms) in finally…");
    run("corepack", ["pnpm", "--filter", "@stay-ops/db", "cleanup:e2e"]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

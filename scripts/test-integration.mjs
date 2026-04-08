#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const win32 = process.platform === "win32";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://stayops:stayops@127.0.0.1:5432/stayops_test";

const env = {
  ...process.env,
  TEST_DATABASE_URL: testDatabaseUrl,
  DATABASE_URL: testDatabaseUrl,
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: root,
    env,
    shell: win32,
    ...opts,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function runCapture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    env,
    encoding: "utf-8",
    shell: win32,
    ...opts,
  });
  if (r.error) throw r.error;
  return r;
}

function ensureTestDatabaseExists() {
  const parsed = new URL(testDatabaseUrl);
  const dbName = parsed.pathname.replace(/^\//, "");
  const dbUser = decodeURIComponent(parsed.username || "stayops");

  if (!dbName) {
    console.error("TEST_DATABASE_URL must include a database name.");
    process.exit(1);
  }

  const createResult = runCapture("docker", [
    "compose",
    "exec",
    "-T",
    "postgres",
    "createdb",
    "-U",
    dbUser,
    dbName,
  ]);

  if (createResult.status === 0) {
    console.log(`Created integration test database '${dbName}'.`);
    return;
  }

  const stderr = (createResult.stderr ?? "").toString();
  if (stderr.includes("already exists")) {
    return;
  }

  if (createResult.status !== 0) {
    console.error(
      "Could not check/create the integration test database. Ensure docker compose postgres is running.",
    );
    process.exit(createResult.status ?? 1);
  }
}

function main() {
  ensureTestDatabaseExists();
  run("corepack", ["pnpm", "--filter", "@stay-ops/db", "migrate:deploy"]);
  run("corepack", ["pnpm", "--filter", "@stay-ops/db", "seed"]);
  run("corepack", [
    "pnpm",
    "--filter",
    "@stay-ops/web",
    "exec",
    "vitest",
    "run",
    "--project",
    "integration",
    "--no-file-parallelism",
  ]);
}

main();

#!/usr/bin/env node
// Integration tests: the Vitest globalSetup (apps/web/tests/integration/globalSetup.ts) starts a
// Testcontainers postgres:16, runs `prisma migrate deploy` and seeds it. Set TEST_DATABASE_URL to
// reuse an existing Postgres instead (docker compose, CI service); no container is started then.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const r = spawnSync(
  "corepack",
  [
    "pnpm",
    "--filter",
    "@stay-ops/web",
    "exec",
    "vitest",
    "run",
    "--project",
    "integration",
    "--no-file-parallelism",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", cwd: root, env: process.env, shell: process.platform === "win32" },
);
if (r.error) throw r.error;
process.exit(r.status ?? 1);

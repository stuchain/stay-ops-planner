#!/usr/bin/env node
/**
 * Copy Postgres data from local docker-compose `postgres` service into the DB
 * pointed to by DATABASE_URL (intended: Neon).
 *
 * Prereqs: Docker running, `docker compose` available, service name `postgres` (see docker-compose.yml).
 * Env: Set DATABASE_URL in repo-root `.env` to your **Neon** connection string, or pass via environment.
 *
 * Optional: SOURCE_POSTGRES_USER, SOURCE_POSTGRES_DB (default stayops / stayops)
 * Optional: FORCE_LOCAL_TARGET=1 to allow restoring to a local URL (dangerous; dev only)
 * Optional: SKIP_MIGRATE=1 to skip `pnpm --filter @stay-ops/db migrate:deploy` after restore
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const text = readFileSync(filePath, "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

const fileEnv = loadEnvFile(path.join(root, ".env"));
const merged = { ...fileEnv, ...process.env };
const targetUrl = merged.DATABASE_URL;
if (!targetUrl) {
  console.error("DATABASE_URL is required (repo-root .env or environment).");
  process.exit(1);
}

const looksLocal =
  /localhost|127\.0\.0\.1|postgres:\d+/.test(targetUrl) ||
  targetUrl.includes("@postgres:");
if (looksLocal && merged.FORCE_LOCAL_TARGET !== "1") {
  console.error(
    "DATABASE_URL looks like a local/Docker URL. Point DATABASE_URL at Neon first.\n" +
      "To override (dangerous), set FORCE_LOCAL_TARGET=1.",
  );
  process.exit(1);
}

const pgUser = merged.SOURCE_POSTGRES_USER ?? "stayops";
const pgDb = merged.SOURCE_POSTGRES_DB ?? "stayops";
const containerDump = "/tmp/stayops.dump";
const tmpDir = path.join(root, "tmp");
const hostDump = path.join(tmpDir, "stayops.dump");

mkdirSync(tmpDir, { recursive: true });

console.log("1/4 Checking Docker postgres is reachable…");
run("docker", ["compose", "exec", "-T", "postgres", "pg_isready", "-U", pgUser, "-d", pgDb]);

console.log("2/4 pg_dump from Docker postgres container…");
run("docker", [
  "compose",
  "exec",
  "-T",
  "postgres",
  "pg_dump",
  "-U",
  pgUser,
  "-d",
  pgDb,
  "-Fc",
  "-f",
  containerDump,
]);

console.log("3/4 Copying dump to host…");
run("docker", ["compose", "cp", `postgres:${containerDump}`, hostDump]);

console.log("4/4 pg_restore into DATABASE_URL (Neon)…");
const args = [
  "run",
  "--rm",
  "-v",
  `${tmpDir}:/data`,
  "postgres:16-alpine",
  "pg_restore",
  "--clean",
  "--if-exists",
  "--no-owner",
  "-d",
  targetUrl,
  "/data/stayops.dump",
];
run("docker", args);

if (merged.SKIP_MIGRATE === "1") {
  console.log("SKIP_MIGRATE=1 — not running migrate:deploy.");
} else {
  console.log("Running prisma migrate deploy against Neon…");
  const dbDir = path.join(root, "packages", "db");
  const env = { ...process.env, ...merged, DATABASE_URL: targetUrl };
  /** Prefer `npx prisma` so global `pnpm` is not required (Windows-friendly). */
  const r = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: dbDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
  });
  if (r.status !== 0) {
    console.error("npx prisma migrate deploy failed. Install deps (pnpm install / npm install) then retry.");
    process.exit(r.status ?? 1);
  }
}

if (merged.KEEP_DUMP !== "1") {
  try {
    rmSync(hostDump);
  } catch {
    /* ignore */
  }
}

console.log("Done. Verify app login or: cd packages/db && npx prisma migrate status");

#!/usr/bin/env node
/**
 * Create or update a user using DATABASE_URL and credentials from repo-root env files.
 *
 * Reads (in order, later overrides): `.env` → `.env.local` → existing process env.
 * Set in `.env` or the shell:
 *   DATABASE_URL=postgresql://...   (Neon, Docker, etc.)
 *   CREATE_USER_EMAIL=you@example.com
 *   CREATE_USER_PASSWORD=at-least-8-chars
 *   CREATE_USER_ROLE=admin          # optional: viewer | operator | admin
 *
 * Usage (repo root):
 *   node ./scripts/db-create-user.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const createUserScript = path.join(root, "packages", "db", "scripts", "create-user.mjs");

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

/** File env first; `process.env` wins (keeps PATH and allows shell overrides). */
const fromEnv = {
  ...loadEnvFile(path.join(root, ".env")),
  ...loadEnvFile(path.join(root, ".env.local")),
  ...process.env,
};

if (!fromEnv.DATABASE_URL?.trim()) {
  console.error("Missing DATABASE_URL. Set it in .env (repo root) or the environment.");
  process.exit(1);
}
if (!fromEnv.CREATE_USER_EMAIL?.trim()) {
  console.error("Missing CREATE_USER_EMAIL. Add it to .env or export it for this shell.");
  process.exit(1);
}
if (!fromEnv.CREATE_USER_PASSWORD || String(fromEnv.CREATE_USER_PASSWORD).length < 8) {
  console.error("Missing or invalid CREATE_USER_PASSWORD (need at least 8 characters).");
  process.exit(1);
}

const r = spawnSync(process.execPath, [createUserScript], {
  cwd: root,
  stdio: "inherit",
  env: fromEnv,
});

process.exit(r.status ?? 1);

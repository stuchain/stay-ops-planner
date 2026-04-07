#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import zlib from "node:zlib";

const restoreUrl = process.env.RESTORE_DATABASE_URL;
if (!restoreUrl) {
  console.error("RESTORE_DATABASE_URL is required for restore verification.");
  process.exit(1);
}

const backupFile = process.argv[2];
if (!backupFile) {
  console.error("Usage: node scripts/restore-verify-postgres.mjs <backup-file.sql.gz>");
  process.exit(1);
}

const absBackup = path.resolve(process.cwd(), backupFile);

const shaPath = `${absBackup}.sha256`;
if (existsSync(shaPath)) {
  const line = readFileSync(shaPath, "utf8").trim().split(/\s+/);
  const expected = line[0];
  const actual = createHash("sha256").update(readFileSync(absBackup)).digest("hex");
  if (expected !== actual) {
    console.error("SHA256 checksum mismatch for backup artifact.");
    console.error(`Expected: ${expected}`);
    console.error(`Actual:   ${actual}`);
    process.exit(1);
  }
  console.log("SHA256 checksum verified.");
}

const sql = zlib.gunzipSync(readFileSync(absBackup));
const psql = spawnSync("psql", [restoreUrl], {
  input: sql,
  shell: false,
  stdio: ["pipe", "inherit", "inherit"],
});

if (psql.status !== 0) {
  console.error("Restore failed.");
  process.exit(psql.status ?? 1);
}

const check = spawnSync(
  "psql",
  [restoreUrl, "-t", "-c", "SELECT 1 AS healthcheck; SELECT count(*)::int AS bookings_count FROM bookings;"],
  { encoding: "utf8", shell: false },
);

if (check.status !== 0) {
  console.error("Restore verification queries failed.");
  process.exit(check.status ?? 1);
}

console.log("Restore verification succeeded.");
console.log(check.stdout.trim());

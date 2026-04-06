#!/usr/bin/env node
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const backupDir = process.env.BACKUP_DIR ?? path.resolve(process.cwd(), "backups", "postgres");
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? "365");
const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

let deleted = 0;
for (const entry of readdirSync(backupDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!entry.name.startsWith("backup-") || !entry.name.endsWith(".sql.gz")) continue;
  const full = path.join(backupDir, entry.name);
  const created = statSync(full).mtimeMs;
  if (created < cutoff) {
    rmSync(full);
    deleted += 1;
  }
}

console.log(`Retention prune complete. Deleted ${deleted} artifact(s).`);

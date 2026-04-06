#!/usr/bin/env node
import { mkdirSync, statSync } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const backupDir = process.env.BACKUP_DIR ?? path.resolve(process.cwd(), "backups", "postgres");
mkdirSync(backupDir, { recursive: true });

const now = new Date();
const stamp = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
const fileName = `backup-${stamp}.sql.gz`;
const outPath = path.join(backupDir, fileName);

const pgDump = spawn("pg_dump", [databaseUrl], { stdio: ["ignore", "pipe", "inherit"] });
const gzip = zlib.createGzip({ level: 9 });
const out = createWriteStream(outPath);

pgDump.stdout.pipe(gzip).pipe(out);

pgDump.on("close", (code) => {
  if (code !== 0) {
    console.error(`pg_dump failed with code ${code}`);
    process.exit(code ?? 1);
  }
});

out.on("finish", () => {
  const size = statSync(outPath).size;
  console.log(`Backup created: ${outPath}`);
  console.log(`Bytes: ${size}`);
});

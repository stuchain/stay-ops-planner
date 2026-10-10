#!/usr/bin/env node
/**
 * Restore rehearsal (P2-8): proves a backup can really be restored, and that the data in the
 * restored copy matches the source. See docs/ops/monitoring.md ("Restore rehearsal").
 *
 * DRY-RUN by default: prints what it would do and touches nothing. Pass --execute to run.
 *
 *   node scripts/restore-rehearsal.mjs                              # dry run
 *   node scripts/restore-rehearsal.mjs --execute                    # dump SOURCE, restore into SCRATCH, compare counts
 *   node scripts/restore-rehearsal.mjs --execute --dump file.dump   # restore an existing pg_dump -Fc file
 *
 * Env:
 *   SOURCE_DATABASE_URL    database to rehearse against (read-only use). Falls back to DATABASE_URL.
 *   SCRATCH_DATABASE_URL   EMPTY scratch database or Neon branch to restore into. Required with --execute.
 *                          Never the same database as the source (the script refuses).
 *
 * Requires pg_dump / pg_restore / psql version 16 or newer on PATH (or run inside the postgres:16 image).
 *
 * Neon point-in-time restore: create a branch from a past moment in the Neon console
 * (Branches > Create branch > "Past data"), then run
 *   SCRATCH_DATABASE_URL=<branch direct url> node scripts/restore-rehearsal.mjs --execute --compare-only
 * which skips dump/restore and only compares row counts (the branch is expected to be slightly older).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Tables whose row counts must match after a restore. */
export const COUNTED_TABLES = ["users", "rooms", "bookings", "assignments", "audit_events", "sync_runs"];

export function parseArgs(argv) {
  const out = { execute: false, compareOnly: false, dump: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") out.execute = true;
    else if (a === "--compare-only") out.compareOnly = true;
    else if (a === "--dump") out.dump = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function hostAndDb(url) {
  const u = new URL(url);
  return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
}

/** Returns an error message when the scratch target is unsafe, otherwise null. */
export function checkTargets(source, scratch, { compareOnly }) {
  if (!source) return "SOURCE_DATABASE_URL (or DATABASE_URL) is not set.";
  if (!scratch) return "SCRATCH_DATABASE_URL is not set. Point it at an EMPTY scratch database or Neon branch.";
  if (!compareOnly && hostAndDb(source) === hostAndDb(scratch)) {
    return "SCRATCH_DATABASE_URL is the same database as the source. Refusing to restore over it.";
  }
  return null;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: false, ...opts });
  if (r.error) throw new Error(`${cmd} could not be started (${r.error.message}). Is the PostgreSQL client installed?`);
  if (r.status !== 0) throw new Error(`${cmd} failed (exit ${r.status}): ${(r.stderr ?? "").trim().slice(0, 500)}`);
  return r.stdout ?? "";
}

function countRows(url) {
  const counts = {};
  for (const table of COUNTED_TABLES) {
    const out = run("psql", [url, "-t", "-A", "-c", `select count(*) from "${table}"`]);
    counts[table] = Number(out.trim());
  }
  return counts;
}

export function compareCounts(source, restored) {
  return COUNTED_TABLES.filter((t) => source[t] !== restored[t]).map(
    (t) => `${t}: source=${source[t]} restored=${restored[t]}`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
  const scratch = process.env.SCRATCH_DATABASE_URL;

  const plan = args.compareOnly
    ? ["compare row counts of source and scratch (no dump, no restore)"]
    : [
        args.dump ? `use existing dump ${args.dump}` : "pg_dump -Fc the source into a temporary file",
        "pg_restore the dump into the scratch database",
        `compare row counts of: ${COUNTED_TABLES.join(", ")}`,
      ];

  if (!args.execute) {
    console.log("DRY RUN (nothing is touched). Add --execute to run. Plan:");
    plan.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    const problem = checkTargets(source, scratch, args);
    if (problem) console.log(`\nNote: ${problem}`);
    else console.log(`\nSource: ${hostAndDb(source)}\nScratch: ${hostAndDb(scratch)}`);
    return;
  }

  const problem = checkTargets(source, scratch, args);
  if (problem) throw new Error(problem);

  let tmp;
  try {
    if (!args.compareOnly) {
      let dumpFile = args.dump;
      if (!dumpFile) {
        tmp = mkdtempSync(path.join(tmpdir(), "restore-rehearsal-"));
        dumpFile = path.join(tmp, "rehearsal.dump");
        console.log("Dumping source...");
        run("pg_dump", ["-Fc", "--no-owner", "--no-privileges", "-f", dumpFile, source]);
      }
      if (statSync(dumpFile).size === 0) throw new Error("Dump file is empty.");
      console.log("Restoring into scratch...");
      run("pg_restore", ["--no-owner", "--no-privileges", "--clean", "--if-exists", "-d", scratch, dumpFile]);
    }
    console.log("Comparing row counts...");
    const a = countRows(source);
    const b = countRows(scratch);
    console.table(COUNTED_TABLES.map((t) => ({ table: t, source: a[t], restored: b[t] })));
    const diffs = compareCounts(a, b);
    if (diffs.length > 0) {
      throw new Error(`Row counts differ (writes during the dump can explain small differences):\n  ${diffs.join("\n  ")}`);
    }
    console.log("Restore rehearsal OK: all row counts match.");
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

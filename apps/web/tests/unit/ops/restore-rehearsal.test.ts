import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../scripts/restore-rehearsal.mjs",
);

function run(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, [script, ...args], {
    env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
}

describe("restore-rehearsal", () => {
  it("is a dry run by default and touches nothing", () => {
    const r = run([], {
      SOURCE_DATABASE_URL: "postgresql://u@src.example/db",
      SCRATCH_DATABASE_URL: "postgresql://u@scratch.example/db",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("DRY RUN");
    expect(r.stdout).toContain("scratch.example");
  });

  it("refuses to restore over the source database", () => {
    const url = "postgresql://u@same.example/db";
    const r = run(["--execute"], { SOURCE_DATABASE_URL: url, SCRATCH_DATABASE_URL: url });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("same database");
  });

  it("needs a scratch database to execute", () => {
    const r = run(["--execute"], { SOURCE_DATABASE_URL: "postgresql://u@src.example/db" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("SCRATCH_DATABASE_URL");
  });
});

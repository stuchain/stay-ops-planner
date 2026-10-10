import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/db/scripts/retention-prune.mjs",
);

type Lib = { resolveRetentionMonths(raw: string | undefined): number };
const load = async () => (await import(/* @vite-ignore */ script)) as Lib;

describe("retention-prune (E2-11)", () => {
  it("defaults to and accepts 12 months or more", async () => {
    const { resolveRetentionMonths } = await load();
    expect(resolveRetentionMonths(undefined)).toBe(12);
    expect(resolveRetentionMonths("")).toBe(12);
    expect(resolveRetentionMonths("12")).toBe(12);
    expect(resolveRetentionMonths("36")).toBe(36);
  });

  it("refuses fewer than 12 months, or nonsense", async () => {
    const { resolveRetentionMonths } = await load();
    for (const bad of ["11", "6", "0", "-1", "abc", "12.5", "NaN"]) {
      expect(() => resolveRetentionMonths(bad), bad).toThrow(/Refusing to prune/);
    }
  });

  it("the script exits non-zero before touching the database", () => {
    const r = spawnSync(process.execPath, [script], {
      env: { ...process.env, RETENTION_MONTHS: "6", DATABASE_URL: "postgresql://nobody@127.0.0.1:1/none" },
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Refusing to prune");
  });
});

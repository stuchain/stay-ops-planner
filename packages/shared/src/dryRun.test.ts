import { describe, expect, it } from "vitest";
import { DryRunRollback, mergeDryRunResults, PlanRecorder, isDryRunRollback } from "./dryRun.js";

describe("PlanRecorder + mergeDryRunResults", () => {
  it("records totals including truncated entries", () => {
    const r = new PlanRecorder(2);
    for (let i = 0; i < 5; i += 1) {
      r.push({ entityType: "booking", action: "update", entityId: `b${i}`, before: null, after: { i } });
    }
    const snap = r.snapshot();
    expect(snap.totals.processed).toBe(5);
    expect(snap.entries).toHaveLength(2);
    expect(snap.truncated).toBe(true);
  });

  it("mergeDryRunResults concatenates warnings and merges totals", () => {
    const a: ReturnType<PlanRecorder["snapshot"]> = {
      dryRun: true,
      totals: { processed: 2, byAction: { update: 2 }, byEntity: { booking: 2 } },
      warnings: [{ code: "A", message: "m1" }],
      entries: [
        { index: 0, entityType: "booking", action: "update", entityId: "1" },
        { index: 1, entityType: "booking", action: "update", entityId: "2" },
      ],
      truncated: false,
    };
    const b: typeof a = {
      dryRun: true,
      totals: { processed: 1, byAction: { create: 1 }, byEntity: { room: 1 } },
      warnings: [{ code: "B", message: "m2" }],
      entries: [{ index: 0, entityType: "room", action: "create", entityId: "r1" }],
      truncated: false,
    };
    const m = mergeDryRunResults([a, b], 10);
    expect(m.totals.processed).toBe(3);
    expect(m.warnings).toHaveLength(2);
    expect(m.entries).toHaveLength(3);
  });

  it("isDryRunRollback detects DryRunRollback", () => {
    const plan = new PlanRecorder().snapshot();
    const err = new DryRunRollback(plan);
    expect(isDryRunRollback(err)).toBe(true);
    expect(isDryRunRollback(new Error("x"))).toBe(false);
  });
});

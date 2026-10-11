// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { isoDate } from "@stay-ops/domain";
import { CLEANER_LINK_DAYS, createCleanerToken, verifyCleanerToken } from "@/server/useCases/cleaningLink";
import { findCleanerConflicts } from "@/server/useCases/cleaningConflicts";

const DAY = isoDate("2030-06-10");
const NOW = new Date("2030-06-08T09:00:00Z");

beforeEach(() => {
  process.env.SESSION_SECRET = "unit-test-secret-unit-test-secret-1234";
});

describe("cleaner link token", () => {
  it("round-trips the day and is valid for 7 days", () => {
    const { token, expiresAt } = createCleanerToken(DAY, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(expiresAt.getTime() - Math.max(NOW.getTime(), Date.parse("2030-06-10T00:00:00Z"))).toBe(
      CLEANER_LINK_DAYS * 86_400_000,
    );
    const check = verifyCleanerToken(token, NOW);
    expect(check).toMatchObject({ ok: true, day: DAY });
  });

  it("carries no guest details", () => {
    const { token } = createCleanerToken(DAY, NOW);
    const payload = Buffer.from(token.split(".")[0]!, "base64url").toString("utf8");
    expect(payload).toMatch(/^2030-06-10\.\d+$/);
  });

  it("expires after its seven days", () => {
    const { token, expiresAt } = createCleanerToken(DAY, NOW);
    expect(verifyCleanerToken(token, new Date(expiresAt.getTime() - 1000)).ok).toBe(true);
    expect(verifyCleanerToken(token, expiresAt)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a changed day, a changed signature, and junk", () => {
    const { token } = createCleanerToken(DAY, NOW);
    const [payload, signature] = token.split(".") as [string, string];
    const otherDay = Buffer.from(
      Buffer.from(payload, "base64url").toString("utf8").replace("2030-06-10", "2030-06-11"),
    ).toString("base64url");
    expect(verifyCleanerToken(`${otherDay}.${signature}`, NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyCleanerToken(`${payload}.${signature.slice(0, -2)}AA`, NOW)).toEqual({ ok: false, reason: "invalid" });
    for (const junk of ["", "abc", "a.b.c", `${payload}.`, ".sig", "!!.??"]) {
      expect(verifyCleanerToken(junk, NOW), junk).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("is bound to the secret and to the cleaner-link prefix", () => {
    const { token } = createCleanerToken(DAY, NOW);
    process.env.SESSION_SECRET = "another-secret-another-secret-another-1";
    expect(verifyCleanerToken(token, NOW)).toEqual({ ok: false, reason: "invalid" });

    // The same payload signed without the prefix (as a session cookie would be) is not accepted.
    process.env.SESSION_SECRET = "unit-test-secret-unit-test-secret-1234";
    const payload = token.split(".")[0]!;
    const bare = createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
    expect(verifyCleanerToken(`${payload}.${bare}`, NOW)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("one cleaner in two places (E4-5)", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2030, 5, 10, h, m));
  const task = (id: string, name: string | null, start: Date, end: Date, status = "todo") => ({
    id,
    status,
    assigneeName: name,
    start,
    end,
  });

  it("flags overlapping open cleanings of the same person, ignoring case and spaces", () => {
    const result = findCleanerConflicts([
      task("a", "Eleni", at(8), at(10)),
      task("b", " eleni ", at(9), at(11)),
      task("c", "Eleni", at(10), at(12)),
      task("d", "Maria", at(8), at(12)),
    ]);
    expect(result.get("a")).toEqual(["b"]);
    expect(result.get("b")).toEqual(["a", "c"]);
    expect(result.get("c")).toEqual(["b"]);
    expect(result.has("d")).toBe(false);
  });

  it("ignores finished, cancelled and unassigned cleanings", () => {
    const result = findCleanerConflicts([
      task("a", "Eleni", at(8), at(10)),
      task("b", "Eleni", at(9), at(11), "done"),
      task("c", "Eleni", at(9), at(11), "cancelled"),
      task("d", null, at(9), at(11)),
      task("e", "  ", at(9), at(11)),
    ]);
    expect(result.size).toBe(0);
  });
});

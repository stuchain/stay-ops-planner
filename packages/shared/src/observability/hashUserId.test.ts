import { describe, expect, it } from "vitest";
import { hashUserId } from "./hashUserId.js";

describe("hashUserId", () => {
  it("is deterministic and not equal to raw id", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const a = hashUserId(id);
    const b = hashUserId(id);
    expect(a).toBe(b);
    expect(a).not.toContain(id);
    expect(a.length).toBe(64);
  });

  it("changes with pepper", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(hashUserId(id, "a")).not.toBe(hashUserId(id, "b"));
  });
});

import { describe, expect, it } from "vitest";
import { safeNextPath } from "../../../src/app/login/safeNextPath";

describe("safeNextPath", () => {
  it("keeps a same-site path", () => {
    expect(safeNextPath("/app")).toBe("/app");
    expect(safeNextPath("/app/calendar?month=2026-07")).toBe("/app/calendar?month=2026-07");
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "", "app", "javascript:alert(1)"])(
    "falls back to the default for %j",
    (value) => {
      expect(safeNextPath(value)).toBe("/app");
    },
  );

  it("falls back to the default for null", () => {
    expect(safeNextPath(null)).toBe("/app");
  });
});

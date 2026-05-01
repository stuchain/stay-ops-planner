import { describe, expect, it } from "vitest";
import { redactForTelemetry } from "./redact.js";

describe("redactForTelemetry", () => {
  it("masks sensitive keys at any depth", () => {
    const input = {
      user: "u1",
      nested: { password: "secret123", ok: 1 },
      headers: { Authorization: "Bearer x" },
    };
    const out = redactForTelemetry(input) as Record<string, unknown>;
    expect(out.user).toBe("u1");
    expect((out.nested as Record<string, unknown>).password).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect((out.headers as Record<string, unknown>).Authorization).toBe("[REDACTED]");
  });
});

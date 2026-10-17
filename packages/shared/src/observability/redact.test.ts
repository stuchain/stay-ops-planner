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

  it("masks guest personal data and typed search text", () => {
    const out = redactForTelemetry({
      guestName: "Maria P",
      guestPhone: "+30 690 000 0000",
      email: "a@b.gr",
      q: "6900000000",
      input: { text: "Maria" },
      bookingId: "b1",
    }) as Record<string, unknown>;
    expect(out.guestName).toBe("[REDACTED]");
    expect(out.guestPhone).toBe("[REDACTED]");
    expect(out.email).toBe("[REDACTED]");
    expect(out.q).toBe("[REDACTED]");
    expect(out.input).toBe("[REDACTED]");
    expect(out.bookingId).toBe("b1");
  });
});

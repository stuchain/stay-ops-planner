import { describe, expect, it } from "vitest";
import { EnvSchema } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  APP_TIMEZONE: "Etc/UTC",
};

describe("EnvSchema", () => {
  it("parses a valid minimal env", () => {
    const result = EnvSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.LOG_LEVEL).toBe("info");
      expect(result.data.HOSTHUB_API_BASE).toBe("https://app.hosthub.com/api/2019-03-01");
    }
  });

  it("rejects missing SESSION_SECRET", () => {
    const { SESSION_SECRET: _, ...rest } = base;
    const result = EnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects short SESSION_SECRET", () => {
    const result = EnvSchema.safeParse({
      ...base,
      SESSION_SECRET: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid DATABASE_URL protocol", () => {
    const result = EnvSchema.safeParse({
      ...base,
      DATABASE_URL: "mysql://localhost:3306/db",
    });
    expect(result.success).toBe(false);
  });

  it("applies optional defaults when optional keys are omitted", () => {
    const result = EnvSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.REDIS_URL).toBeUndefined();
      expect(result.data.SESSION_COOKIE_SECURE).toBe("auto");
    }
  });

  it("accepts SESSION_COOKIE_SECURE overrides", () => {
    const r1 = EnvSchema.safeParse({ ...base, SESSION_COOKIE_SECURE: "true" });
    expect(r1.success).toBe(true);
    if (r1.success) expect(r1.data.SESSION_COOKIE_SECURE).toBe("true");
    const r2 = EnvSchema.safeParse({ ...base, SESSION_COOKIE_SECURE: "false" });
    expect(r2.success).toBe(true);
    if (r2.success) expect(r2.data.SESSION_COOKIE_SECURE).toBe("false");
  });
});

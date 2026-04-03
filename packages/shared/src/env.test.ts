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
      expect(result.data.HOSTHUB_API_BASE).toBe("https://app.hosthub.com");
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
    }
  });
});

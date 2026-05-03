import { afterEach, describe, expect, it } from "vitest";
import { resolveSessionCookieSecure } from "@/modules/auth/session";

describe("resolveSessionCookieSecure", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env.NODE_ENV = prev.NODE_ENV;
    process.env.SESSION_COOKIE_SECURE = prev.SESSION_COOKIE_SECURE;
  });

  it("auto is true in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_COOKIE_SECURE;
    expect(resolveSessionCookieSecure()).toBe(true);
  });

  it("auto is false outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.SESSION_COOKIE_SECURE;
    expect(resolveSessionCookieSecure()).toBe(false);
  });

  it("true forces secure", () => {
    process.env.NODE_ENV = "development";
    process.env.SESSION_COOKIE_SECURE = "true";
    expect(resolveSessionCookieSecure()).toBe(true);
  });

  it("false disables secure in production", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_COOKIE_SECURE = "false";
    expect(resolveSessionCookieSecure()).toBe(false);
  });
});

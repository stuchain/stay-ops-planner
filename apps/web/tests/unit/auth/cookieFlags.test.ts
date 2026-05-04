import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSessionCookieSecure } from "@/modules/auth/session";

describe("resolveSessionCookieSecure", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("auto is true in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveSessionCookieSecure()).toBe(true);
  });

  it("auto is false outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(resolveSessionCookieSecure()).toBe(false);
  });

  it("true forces secure", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_COOKIE_SECURE", "true");
    expect(resolveSessionCookieSecure()).toBe(true);
  });

  it("false disables secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_COOKIE_SECURE", "false");
    expect(resolveSessionCookieSecure()).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
import {
  createSessionToken,
  refreshSessionTokenIfNeeded,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_INACTIVITY_TTL_SECONDS,
  SESSION_REFRESH_THRESHOLD_SECONDS,
  verifySessionToken,
  type VerifiedSession,
} from "@/modules/auth/session";

describe("refreshSessionTokenIfNeeded", () => {
  const baseUser = "user-1";
  const baseRole = "operator" as const;

  it("returns null when token is younger than refresh threshold", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const { token } = createSessionToken(baseUser, baseRole, now);
    const v = verifySessionToken(token, now + (SESSION_REFRESH_THRESHOLD_SECONDS - 1) * 1000)!;
    expect(refreshSessionTokenIfNeeded(v, now + (SESSION_REFRESH_THRESHOLD_SECONDS - 1) * 1000)).toBeNull();
  });

  it("re-issues when past threshold and extends sliding exp up to aexp", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const { token } = createSessionToken(baseUser, baseRole, now);
    const v = verifySessionToken(token, now + (SESSION_REFRESH_THRESHOLD_SECONDS + 10) * 1000)!;
    const out = refreshSessionTokenIfNeeded(v, now + (SESSION_REFRESH_THRESHOLD_SECONDS + 10) * 1000);
    expect(out).not.toBeNull();
    const nowS = Math.floor((now + (SESSION_REFRESH_THRESHOLD_SECONDS + 10) * 1000) / 1000);
    const expectedExp = Math.min(nowS + SESSION_INACTIVITY_TTL_SECONDS, v.aexpUnixSeconds!);
    const v2 = verifySessionToken(out!.token, now + (SESSION_REFRESH_THRESHOLD_SECONDS + 10) * 1000)!;
    expect(v2.expUnixSeconds).toBe(expectedExp);
    expect(v2.aexpUnixSeconds).toBe(v.aexpUnixSeconds);
    expect(v2.iatUnixSeconds).toBe(nowS);
  });

  it("does not extend exp beyond aexp near end of absolute window", () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0);
    const { token } = createSessionToken(baseUser, baseRole, nowMs);
    const v0 = verifySessionToken(token, nowMs)!;
    const aexp = v0.aexpUnixSeconds!;
    const nearEnd = (aexp - 120) * 1000;
    const v: VerifiedSession = {
      ...v0,
      iatUnixSeconds: Math.floor(nearEnd / 1000) - SESSION_REFRESH_THRESHOLD_SECONDS - 10,
      expUnixSeconds: Math.floor(nearEnd / 1000) + 30,
    };
    const out = refreshSessionTokenIfNeeded(v, nearEnd);
    expect(out).not.toBeNull();
    const v2 = verifySessionToken(out!.token, nearEnd)!;
    expect(v2.expUnixSeconds).toBeLessThanOrEqual(aexp);
    expect(v2.expUnixSeconds).toBe(aexp);
  });
});

describe("createSessionToken + verifySessionToken", () => {
  it("embeds aexp and exp with 12h absolute and 60m inactivity", () => {
    const now = Date.UTC(2026, 5, 2, 8, 0, 0);
    const { token, expiresAt } = createSessionToken("u", "admin", now);
    const iat = Math.floor(now / 1000);
    const v = verifySessionToken(token, now)!;
    expect(v.aexpUnixSeconds).toBe(iat + SESSION_ABSOLUTE_TTL_SECONDS);
    expect(v.expUnixSeconds).toBe(iat + SESSION_INACTIVITY_TTL_SECONDS);
    expect(expiresAt.getTime()).toBe(v.expUnixSeconds * 1000);
  });
});

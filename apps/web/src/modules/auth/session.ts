import crypto from "node:crypto";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "stay_ops_session";

/** Absolute cap from original login (first `iat` + this). */
export const SESSION_ABSOLUTE_TTL_SECONDS = 12 * 60 * 60;
/** Sliding inactivity window for each issued token. */
export const SESSION_INACTIVITY_TTL_SECONDS = 60 * 60;
/** Re-issue cookie only if token is at least this old (reduces churn). */
export const SESSION_REFRESH_THRESHOLD_SECONDS = 5 * 60;

/** @deprecated Use SESSION_INACTIVITY_TTL_SECONDS for cookie maxAge hints; kept for tests importing old name. */
export const SESSION_TTL_SECONDS = SESSION_INACTIVITY_TTL_SECONDS;

/** Persisted user role; embedded in session token for middleware (JWT only). API handlers re-load from DB. */
export type SessionRole = "viewer" | "operator" | "admin";

type SessionPayload = {
  sub: string;
  /** Added in Epic 4; omitted in legacy tokens (treated as operator). */
  role?: SessionRole;
  iat: number;
  exp: number;
  /** Absolute session end (unix seconds). Omitted in legacy tokens (pre–Epic 7). */
  aexp?: number;
};

const SESSION_ROLES: readonly SessionRole[] = ["viewer", "operator", "admin"];

function parseSessionRole(value: unknown): SessionRole | undefined {
  if (typeof value !== "string") return undefined;
  return SESSION_ROLES.includes(value as SessionRole) ? (value as SessionRole) : undefined;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set");
  }
  return secret;
}

function base64UrlEncode(input: Buffer) {
  return input.toString("base64url");
}

function signPayloadBase64(payloadBase64Url: string): string {
  const secret = getSessionSecret();
  const sig = crypto.createHmac("sha256", secret).update(payloadBase64Url).digest();
  return base64UrlEncode(sig);
}

/** Cookie `Secure` flag: `SESSION_COOKIE_SECURE` = auto | true | false (default auto = production only). */
export function resolveSessionCookieSecure(): boolean {
  const raw = (process.env.SESSION_COOKIE_SECURE ?? "auto").toLowerCase().trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return process.env.NODE_ENV === "production";
}

export type VerifiedSession = {
  userId: string;
  role: SessionRole;
  /** Sliding expiry (inactivity) for this token issuance. */
  expiresAt: Date;
  expUnixSeconds: number;
  iatUnixSeconds: number;
  /** Absolute end of login session; null for legacy tokens without `aexp`. */
  aexpUnixSeconds: number | null;
};

export function createSessionToken(userId: string, role: SessionRole, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const aexp = iat + SESSION_ABSOLUTE_TTL_SECONDS;
  const exp = Math.min(iat + SESSION_INACTIVITY_TTL_SECONDS, aexp);
  const payload: SessionPayload = { sub: userId, role, iat, exp, aexp };

  const payloadJson = JSON.stringify(payload);
  const payloadBase64Url = base64UrlEncode(Buffer.from(payloadJson, "utf8"));
  const signature = signPayloadBase64(payloadBase64Url);
  const token = `${payloadBase64Url}.${signature}`;

  return {
    token,
    expiresAt: new Date(exp * 1000),
    expUnixSeconds: exp,
  };
}

/**
 * Re-issue token with fresh sliding `exp` if past refresh threshold, preserving `aexp`.
 * Returns null if no refresh needed or session is legacy / expired.
 */
export function refreshSessionTokenIfNeeded(session: VerifiedSession, nowMs = Date.now()): { token: string; expiresAt: Date } | null {
  if (session.aexpUnixSeconds === null) return null;

  const nowS = Math.floor(nowMs / 1000);
  if (nowS >= session.aexpUnixSeconds) return null;
  if (nowS > session.expUnixSeconds) return null;

  if (nowS - session.iatUnixSeconds < SESSION_REFRESH_THRESHOLD_SECONDS) {
    return null;
  }

  const iat = nowS;
  const aexp = session.aexpUnixSeconds;
  const exp = Math.min(iat + SESSION_INACTIVITY_TTL_SECONDS, aexp);
  const payload: SessionPayload = {
    sub: session.userId,
    role: session.role,
    iat,
    exp,
    aexp,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadBase64Url = base64UrlEncode(Buffer.from(payloadJson, "utf8"));
  const signature = signPayloadBase64(payloadBase64Url);
  const token = `${payloadBase64Url}.${signature}`;

  return {
    token,
    expiresAt: new Date(exp * 1000),
  };
}

export function verifySessionToken(token: string, nowMs = Date.now()): VerifiedSession | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadBase64Url, signatureBase64Url] = parts;
  if (!payloadBase64Url || !signatureBase64Url) return null;

  const expectedSignature = signPayloadBase64(payloadBase64Url);

  const sigBuf = Buffer.from(signatureBase64Url, "base64url");
  const expectedBuf = Buffer.from(expectedSignature, "base64url");
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: unknown;
  try {
    const payloadJson = Buffer.from(payloadBase64Url, "base64url").toString("utf8");
    payload = JSON.parse(payloadJson) as SessionPayload;
  } catch {
    return null;
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !("sub" in payload) ||
    !("iat" in payload) ||
    !("exp" in payload)
  ) {
    return null;
  }

  const p = payload as SessionPayload;
  if (typeof p.sub !== "string") return null;
  if (typeof p.iat !== "number") return null;
  if (typeof p.exp !== "number") return null;

  const nowUnixSeconds = Math.floor(nowMs / 1000);

  const aexp =
    typeof p.aexp === "number" && Number.isFinite(p.aexp) ? p.aexp : null;

  if (aexp !== null) {
    if (nowUnixSeconds >= aexp) return null;
    if (nowUnixSeconds > p.exp) return null;
  } else {
    // Legacy token (no absolute cap field): sliding deadline only.
    if (p.exp <= nowUnixSeconds) return null;
  }

  const role = parseSessionRole(p.role) ?? "operator";

  return {
    userId: p.sub,
    role,
    expiresAt: new Date(p.exp * 1000),
    expUnixSeconds: p.exp,
    iatUnixSeconds: p.iat,
    aexpUnixSeconds: aexp,
  };
}

export function readCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/** Works with `NextRequest` or plain `Request` (tests) for session cookie. */
export function getSessionTokenFromRequest(request: {
  headers: Headers;
  cookies?: { get: (name: string) => { value: string } | undefined };
}): string | null {
  try {
    const v = request.cookies?.get?.(SESSION_COOKIE_NAME)?.value;
    if (v) return v;
  } catch {
    // ignore
  }
  return readCookieValue(request.headers.get("cookie"), SESSION_COOKIE_NAME);
}

function cookieMaxAgeSeconds(expiresAt: Date, nowMs: number): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - nowMs) / 1000));
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date, nowMs = Date.now()) {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: resolveSessionCookieSecure(),
    path: "/",
    expires: expiresAt,
    maxAge: cookieMaxAgeSeconds(expiresAt, nowMs),
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: resolveSessionCookieSecure(),
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}

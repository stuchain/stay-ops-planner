import crypto from "node:crypto";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "stay_ops_session";
export const SESSION_TTL_SECONDS = 24 * 60 * 60; // exactly 24h

/** Persisted user role; embedded in session token for middleware (JWT only). API handlers re-load from DB. */
export type SessionRole = "viewer" | "operator" | "admin";

type SessionPayload = {
  sub: string;
  /** Added in Epic 4; omitted in legacy tokens (treated as operator). */
  role?: SessionRole;
  iat: number; // unix seconds
  exp: number; // unix seconds
};

const SESSION_ROLES: readonly SessionRole[] = ["viewer", "operator", "admin"];

function parseSessionRole(value: unknown): SessionRole | undefined {
  if (typeof value !== "string") return undefined;
  return SESSION_ROLES.includes(value as SessionRole) ? (value as SessionRole) : undefined;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // Env validation should catch this earlier; this is a defensive fallback for tests.
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

export function createSessionToken(userId: string, role: SessionRole, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const payload: SessionPayload = { sub: userId, role, iat, exp };

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

export function verifySessionToken(token: string, nowMs = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadBase64Url, signatureBase64Url] = parts;
  if (!payloadBase64Url || !signatureBase64Url) return null;

  const expectedSignature = signPayloadBase64(payloadBase64Url);

  // timingSafeEqual requires equal-length buffers.
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
  if (p.exp <= nowUnixSeconds) return null;

  const role = parseSessionRole(p.role) ?? "operator";

  return {
    userId: p.sub,
    role,
    expiresAt: new Date(p.exp * 1000),
    expUnixSeconds: p.exp,
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

function isProd() {
  return process.env.NODE_ENV === "production";
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}


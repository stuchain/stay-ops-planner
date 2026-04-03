import type { NextRequest } from "next/server";
import { AuthError } from "./errors";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session";

export type AuthContext = {
  userId: string;
  sessionExpiresAt: Date;
};

export function getSessionContextFromRequest(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  const token = cookie?.value;

  if (!token) {
    return { context: null as AuthContext | null, tokenPresent: false };
  }

  const session = verifySessionToken(token);
  if (!session) {
    return { context: null as AuthContext | null, tokenPresent: true };
  }

  return {
    context: {
      userId: session.userId,
      sessionExpiresAt: session.expiresAt,
    } satisfies AuthContext,
    tokenPresent: true,
  };
}

export function requireSession(request: NextRequest): AuthContext {
  const { context } = getSessionContextFromRequest(request);
  if (!context) {
    throw new AuthError({
      code: "UNAUTHORIZED",
      status: 401,
      message: "Authentication required",
    });
  }
  return context;
}

// Phase 1 uses internal admins only (single role), so the admin guard is identical to session guard.
export function requireAdminSession(request: NextRequest): AuthContext {
  return requireSession(request);
}


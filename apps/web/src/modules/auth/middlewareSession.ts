import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  type VerifiedSession,
} from "./session";
import type { AuthContext } from "./authContext";

/**
 * JWT-only session parsing for Next.js middleware.
 * Must not import Prisma — middleware bundles run on Vercel Edge-like paths and cannot load the Query Engine.
 */
export function getSessionContextFromRequest(request: NextRequest): {
  context: AuthContext | null;
  tokenPresent: boolean;
  verified?: VerifiedSession;
} {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  const token = cookie?.value;

  if (!token) {
    return { context: null, tokenPresent: false };
  }

  const session = verifySessionToken(token);
  if (!session) {
    return { context: null, tokenPresent: true };
  }

  return {
    context: {
      userId: session.userId,
      sessionExpiresAt: session.expiresAt,
      role: session.role,
    },
    tokenPresent: true,
    verified: session,
  };
}

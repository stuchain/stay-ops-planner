import type { NextRequest } from "next/server";
import { Prisma } from "@stay-ops/db";
import { prisma } from "@/lib/prisma";
import { AuthError } from "./errors";
import { SESSION_COOKIE_NAME, verifySessionToken, type SessionRole, type VerifiedSession } from "./session";

export type AuthContext = {
  userId: string;
  sessionExpiresAt: Date;
  role: SessionRole;
};

const ALL_ROLES: readonly SessionRole[] = ["viewer", "operator", "admin"];

function forbidden(): AuthError {
  return new AuthError({
    code: "FORBIDDEN",
    status: 403,
    message: "Insufficient permissions",
  });
}

function parseDbRole(value: string): SessionRole | null {
  return ALL_ROLES.includes(value as SessionRole) ? (value as SessionRole) : null;
}

function isMissingRoleColumnError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2010") return false;
  const meta = err.meta as { code?: string; message?: string } | undefined;
  return meta?.code === "42703" && typeof meta.message === "string" && meta.message.includes("\"role\"");
}

/**
 * Cookie + DB-backed auth context for API routes and server components.
 */
export async function verifyAndLoadAuthContext(token: string | null): Promise<AuthContext | null> {
  if (!token) return null;
  const session = verifySessionToken(token);
  if (!session) return null;

  let role: SessionRole | null = null;
  let isActive = false;
  try {
    const rows = await prisma.$queryRaw<Array<{ role: string; is_active: boolean }>>`
      SELECT role::text as role, is_active FROM users WHERE id = ${session.userId} LIMIT 1
    `;
    const row = rows[0];
    if (!row || !row.is_active) return null;
    isActive = row.is_active;
    role = parseDbRole(row.role);
  } catch (err) {
    if (!isMissingRoleColumnError(err)) throw err;
    // Transitional fallback: DB not migrated yet. Preserve auth and treat as operator.
    const rows = await prisma.$queryRaw<Array<{ is_active: boolean }>>`
      SELECT is_active FROM users WHERE id = ${session.userId} LIMIT 1
    `;
    const row = rows[0];
    if (!row || !row.is_active) return null;
    isActive = row.is_active;
    role = "operator";
  }
  if (!isActive || !role) return null;

  return {
    userId: session.userId,
    sessionExpiresAt: session.expiresAt,
    role,
  };
}

/** Synchronous JWT-only context for middleware (no DB). */
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
    } satisfies AuthContext,
    tokenPresent: true,
    verified: session,
  };
}

export async function requireSession(request: NextRequest): Promise<AuthContext> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const ctx = await verifyAndLoadAuthContext(token);
  if (!ctx) {
    throw new AuthError({
      code: "UNAUTHORIZED",
      status: 401,
      message: "Authentication required",
    });
  }
  return ctx;
}

export function requireAnyRole(context: AuthContext, allowed: readonly SessionRole[]): AuthContext {
  if (!allowed.includes(context.role)) {
    throw forbidden();
  }
  return context;
}

export async function requireSessionWithRoles(
  request: NextRequest,
  allowed: readonly SessionRole[],
): Promise<AuthContext> {
  const ctx = await requireSession(request);
  return requireAnyRole(ctx, allowed);
}

export async function requireAdminSession(request: NextRequest): Promise<AuthContext> {
  return requireSessionWithRoles(request, ["admin"]);
}

export async function requireOperatorOrAdmin(request: NextRequest): Promise<AuthContext> {
  return requireSessionWithRoles(request, ["operator", "admin"]);
}

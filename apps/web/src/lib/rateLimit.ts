import { log } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiError";
import { getClientIp } from "@/lib/clientIp";
import { verifyAndLoadAuthContext } from "@/modules/auth/guard";
import { getSessionTokenFromRequest } from "@/modules/auth/session";

export type RateLimitRule = { limit: number; windowMs: number; key: "user" | "ip" };

/** Default per-user budget for authenticated mutations (per minute). */
export const DEFAULT_USER_RATE_RULES: RateLimitRule[] = [{ key: "user", limit: 60, windowMs: 60_000 }];

/** Tighter budget for expensive sync triggers. */
export const SYNC_USER_RATE_RULES: RateLimitRule[] = [{ key: "user", limit: 5, windowMs: 60_000 }];

/** Login is unauthenticated — limit by IP only. */
export const LOGIN_IP_RATE_RULES: RateLimitRule[] = [{ key: "ip", limit: 60, windowMs: 60_000 }];

async function bumpCounter(scope: string, bucketKey: string, windowStart: Date): Promise<number> {
  const rows = await prisma.$queryRaw<[{ count: number }]>`
    INSERT INTO rate_limit_counters (scope, bucket_key, window_start, count)
    VALUES (${scope}, ${bucketKey}, ${windowStart}, 1)
    ON CONFLICT (scope, bucket_key, window_start)
    DO UPDATE SET count = rate_limit_counters.count + 1
    RETURNING count
  `;
  return Number(rows[0]?.count ?? 0);
}

function opportunisticCleanup(): void {
  void prisma.$executeRaw`
    DELETE FROM rate_limit_counters WHERE window_start < NOW() - INTERVAL '1 hour'
  `.catch(() => undefined);
}

/**
 * Fixed-window rate limiter backed by Postgres. On DB errors, degrades open (allows request).
 * For rules with `key: "user"`, requires an authenticated session or returns 401 before handler.
 */
export async function withRateLimit(
  scope: string,
  rules: RateLimitRule[],
  request: Request,
  handler: (request: Request) => Promise<Response>,
): Promise<Response> {
  const token = getSessionTokenFromRequest(request);
  const ctx = await verifyAndLoadAuthContext(token);

  if (rules.some((r) => r.key === "user") && !ctx) {
    return apiError(request, "UNAUTHORIZED", "Authentication required", 401);
  }

  const now = Date.now();

  try {
    for (const rule of rules) {
      const bucketKey =
        rule.key === "user" ? `user:${ctx!.userId}` : `ip:${getClientIp(request)}`;
      const windowStartMs = Math.floor(now / rule.windowMs) * rule.windowMs;
      const windowStart = new Date(windowStartMs);
      const count = await bumpCounter(scope, bucketKey, windowStart);
      if (count > rule.limit) {
        const retryAfterSec = Math.max(1, Math.ceil((windowStartMs + rule.windowMs - now) / 1000));
        return apiError(request, "RATE_LIMITED", "Too many requests", 429, { retryAfterSeconds: retryAfterSec });
      }
    }
    opportunisticCleanup();
  } catch (err) {
    log("warn", "rate_limit_degraded", {
      scope,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return handler(request);
}

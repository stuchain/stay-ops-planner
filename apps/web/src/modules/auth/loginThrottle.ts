import { prisma } from "@/lib/prisma";
import { AuthError } from "./errors";

export const LOGIN_IP_LIMIT = 10;
export const LOGIN_EMAIL_LIMIT = 5;
/** Same window as `assertLoginAllowed` (used by diagnostics). */
export const LOGIN_WINDOW_MS = 15 * 60_000;

function rateLimitedAuth(): AuthError {
  return new AuthError({
    code: "RATE_LIMITED",
    status: 429,
    message: "Too many login attempts; try again later",
    details: { retryAfterSeconds: Math.ceil(LOGIN_WINDOW_MS / 1000) },
  });
}

export async function assertLoginAllowed(emailNorm: string, ip: string): Promise<void> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);

  const [emailFails, ipFails] = await Promise.all([
    prisma.loginAttempt.count({
      where: { email: emailNorm, succeeded: false, createdAt: { gte: since } },
    }),
    prisma.loginAttempt.count({
      where: { ip, succeeded: false, createdAt: { gte: since } },
    }),
  ]);

  if (emailFails >= LOGIN_EMAIL_LIMIT || ipFails >= LOGIN_IP_LIMIT) {
    throw rateLimitedAuth();
  }
}

import { prisma } from "@/lib/prisma";
import { AuthError } from "./errors";

/** Both users share one home IP, so the per-IP limit is well above the per-email one. */
export const LOGIN_IP_LIMIT = 30;
export const LOGIN_EMAIL_LIMIT = 5;
/** Same window as `assertLoginAllowed` (used by diagnostics). */
export const LOGIN_WINDOW_MS = 15 * 60_000;

/**
 * Seconds until enough failures leave the window to lift the block, when `times` (ascending) holds at
 * least `limit` of them; null when not locked.
 */
export function secondsUntilUnlocked(times: readonly Date[], limit: number, now = Date.now()): number | null {
  if (times.length < limit) return null;
  const decisive = times[times.length - limit]!;
  return Math.max(1, Math.ceil((decisive.getTime() + LOGIN_WINDOW_MS - now) / 1000));
}

async function failureTimes(where: { email: string } | { ip: string }, now: number): Promise<Date[]> {
  const rows = await prisma.loginAttempt.findMany({
    where: { ...where, succeeded: false, createdAt: { gte: new Date(now - LOGIN_WINDOW_MS) } },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.createdAt);
}

/** Seconds the sign-in with this email stays blocked (the longer of the email and IP blocks), or null. */
export async function loginLockSeconds(emailNorm: string, ip?: string, now = Date.now()): Promise<number | null> {
  const [emailTimes, ipTimes] = await Promise.all([
    failureTimes({ email: emailNorm }, now),
    ip ? failureTimes({ ip }, now) : Promise.resolve([] as Date[]),
  ]);
  const waits = [
    secondsUntilUnlocked(emailTimes, LOGIN_EMAIL_LIMIT, now),
    secondsUntilUnlocked(ipTimes, LOGIN_IP_LIMIT, now),
  ].filter((n): n is number => n !== null);
  return waits.length ? Math.max(...waits) : null;
}

export async function assertLoginAllowed(emailNorm: string, ip: string): Promise<void> {
  const wait = await loginLockSeconds(emailNorm, ip);
  if (wait === null) return;
  throw new AuthError({
    code: "RATE_LIMITED",
    status: 429,
    message: "Too many login attempts; try again later",
    details: { retryAfterSeconds: wait },
  });
}

/** A successful sign-in wipes the failures that led up to it. */
export async function clearLoginFailures(emailNorm: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { email: emailNorm, succeeded: false } });
}

/**
 * An admin unlocks a user: the failures for their email, and the failures from the IPs those came from,
 * so a block caused by the shared home IP is lifted too.
 */
export async function unlockLogin(emailNorm: string): Promise<{ cleared: number }> {
  const ips = await prisma.loginAttempt.findMany({
    where: { email: emailNorm, succeeded: false },
    distinct: ["ip"],
    select: { ip: true },
  });
  const res = await prisma.loginAttempt.deleteMany({
    where: { succeeded: false, OR: [{ email: emailNorm }, { ip: { in: ips.map((r) => r.ip) } }] },
  });
  return { cleared: res.count };
}

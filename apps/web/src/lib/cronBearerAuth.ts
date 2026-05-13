import { timingSafeEqual, createHash } from "node:crypto";

/**
 * Constant-time compare for cron Bearer token. Returns false if lengths differ
 * or secret is not configured (caller should treat as unauthorized).
 */
export function verifyCronBearerToken(authorizationHeader: string | null, expectedSecret: string | undefined): boolean {
  if (!expectedSecret || expectedSecret.length < 16) {
    return false;
  }
  const raw = authorizationHeader?.trim() ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  const presented = m?.[1]?.trim();
  if (!presented) {
    return false;
  }
  // Hash to equal length digests so timingSafeEqual can run without leaking length hints.
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expectedSecret, "utf8").digest();
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

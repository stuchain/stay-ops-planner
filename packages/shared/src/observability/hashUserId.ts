import { createHash } from "node:crypto";

/**
 * One-way fingerprint for correlating events without sending raw user ids.
 * Optional pepper (e.g. `SENTRY_USER_ID_PEPPER`) makes rainbow tables harder.
 */
export function hashUserId(userId: string, pepper?: string | undefined): string {
  const h = createHash("sha256");
  h.update("stayops:user:");
  h.update(userId);
  if (pepper && pepper.length > 0) {
    h.update(":");
    h.update(pepper);
  }
  return h.digest("hex");
}

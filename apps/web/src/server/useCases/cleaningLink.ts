import { createHmac, timingSafeEqual } from "node:crypto";
import { isIsoDate, type IsoDate } from "@stay-ops/domain";
import { dbDateToIso, isoToDbDate } from "@/server/time";

/** Keeps a cleaner-link signature from ever being valid for another purpose that signs with the same secret. */
const DOMAIN_PREFIX = "cleaner-link:v1:";

/** A link works for this long after it was made (or after its day starts, for a day still to come). */
export const CLEANER_LINK_DAYS = 7;

const DAY_MS = 86_400_000;

export type CleanerLinkCheck =
  { ok: true; day: IsoDate; expiresAt: Date } | { ok: false; reason: "invalid" | "expired" };

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set");
  return value;
}

function sign(payload: string): Buffer {
  return createHmac("sha256", secret()).update(`${DOMAIN_PREFIX}${payload}`).digest();
}

/** When a link for `day`, made at `now`, stops working. */
export function cleanerLinkExpiry(day: IsoDate, now: Date): Date {
  const start = isoToDbDate(day).getTime();
  return new Date(Math.max(now.getTime(), start) + CLEANER_LINK_DAYS * DAY_MS);
}

/**
 * A read-only link token for one day: `base64url("YYYY-MM-DD.expiryUnixSeconds")` and an HMAC-SHA256
 * of it with the session secret, separated by a dot. Nothing in it names a guest.
 */
export function createCleanerToken(day: IsoDate, now: Date = new Date()): { token: string; expiresAt: Date } {
  const expiresAt = cleanerLinkExpiry(day, now);
  const payload = Buffer.from(`${day}.${Math.floor(expiresAt.getTime() / 1000)}`, "utf8").toString("base64url");
  const signature = sign(payload).toString("base64url");
  return { token: `${payload}.${signature}`, expiresAt };
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Checks the signature in constant time, then the expiry. A forged, damaged or cut-off token is `invalid`. */
export function verifyCleanerToken(token: string, now: Date = new Date()): CleanerLinkCheck {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const [payload, signature] = parts as [string, string];
  if (!BASE64URL.test(payload) || !BASE64URL.test(signature)) return { ok: false, reason: "invalid" };

  const expected = sign(payload);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "invalid" };

  const match = /^(\d{4}-\d{2}-\d{2})\.(\d{1,12})$/.exec(Buffer.from(payload, "base64url").toString("utf8"));
  const day = match?.[1];
  if (!match || !day || !isIsoDate(day) || dbDateToIso(isoToDbDate(day)) !== day) {
    return { ok: false, reason: "invalid" };
  }
  const expiresAt = new Date(Number(match[2]) * 1000);
  if (expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, day, expiresAt };
}

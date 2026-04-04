import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Default header for HMAC-SHA256 of raw body (confirm against Hosthub docs in production). */
export const HOSTHUB_WEBHOOK_SIGNATURE_HEADER = "x-hosthub-signature";

export function sha256HexUtf8(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Expected format: `sha256=<hex>`. Constant-time comparison; never log the secret or raw signature.
 */
export function verifyHosthubWebhookSignature(
  rawBody: string,
  secret: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader?.toLowerCase().startsWith("sha256=")) {
    return false;
  }
  const theirHex = signatureHeader.slice("sha256=".length).trim();
  if (!/^[0-9a-f]+$/i.test(theirHex) || theirHex.length % 2 !== 0) {
    return false;
  }
  const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(theirHex, "hex");
  const b = Buffer.from(expectedHex, "hex");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

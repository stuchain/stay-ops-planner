/**
 * Deep-redact sensitive keys for logs and telemetry (Sentry, etc.).
 * Preserves structure; replaces scalar values with a fixed mask.
 */
const MASK = "[REDACTED]";

const SENSITIVE_KEY_RE = new RegExp(
  [
    "password",
    "passwd",
    "secret",
    "token",
    "authorization",
    "cookie",
    "set-cookie",
    "session",
    "apikey",
    "api_key",
    "access_token",
    "refresh_token",
    "client_secret",
  ].join("|"),
  "i",
);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

export function redactForTelemetry(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => redactForTelemetry(item));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = MASK;
      } else {
        out[k] = redactForTelemetry(v);
      }
    }
    return out;
  }
  return MASK;
}

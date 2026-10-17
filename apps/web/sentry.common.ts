import { redactForTelemetry } from "@stay-ops/shared/observability/redact";

/** Minimal Sentry event shape for `beforeSend` scrubbing (avoids direct `@sentry/core` dependency). */
export type ScrubbableSentryEvent = {
  message?: string;
  transaction?: string;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  request?: {
    url?: string;
    query_string?: unknown;
    data?: unknown;
    headers?: Record<string, string>;
    cookies?: unknown;
  };
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<ScrubbableBreadcrumb>;
  spans?: Array<{ description?: string; data?: Record<string, unknown> }>;
};

export type ScrubbableBreadcrumb = { message?: string; data?: Record<string, unknown> | undefined };

/**
 * The phone feed (`/feed/<token>`) and cleaner link (`/c/<token>`) carry their secret in the path,
 * and search / tRPC GET queries carry what was typed (guest names, phones) in the query string.
 */
const TOKEN_PATH_RE = /\/(feed|c)\/[^/?#\s"']+/g;
const QUERY_RE = /\?[^\s"'#]*/g;
const EMAIL_RE = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[a-z]{2,}/gi;
/** 8+ digits, optionally starting with + and split by spaces, dots or dashes: a phone number. */
const PHONE_RE = /\+?\d(?:[\s.-]?\d){7,}/g;

/** Drops query strings and path tokens from a URL or any text containing one. */
export function scrubUrl(value: string): string {
  return value.replace(TOKEN_PATH_RE, "/$1/[token]").replace(QUERY_RE, (q) => (q === "?" ? q : "?[filtered]"));
}

/** Masks e-mail addresses, phone numbers, path tokens and query strings in free text (error messages). */
export function scrubText(value: string): string {
  return scrubUrl(value).replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
}

function scrubRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = redactForTelemetry(value) as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string") out[k] = scrubUrl(v);
  }
  return out;
}

export function scrubBreadcrumb<T extends ScrubbableBreadcrumb>(breadcrumb: T): T {
  if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
  if (breadcrumb.data) breadcrumb.data = scrubRecord(breadcrumb.data);
  return breadcrumb;
}

/**
 * Applied in Sentry `beforeSend` and `beforeSendTransaction` for all Next runtimes (server, client, edge):
 * no guest data, typed search text, path tokens or cookies leave the app.
 */
export function scrubSentryEvent<T extends ScrubbableSentryEvent>(event: T): T {
  if (event.message) event.message = scrubText(event.message);
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  if (event.extra) event.extra = scrubRecord(event.extra) ?? {};
  if (event.contexts) event.contexts = scrubRecord(event.contexts) ?? {};
  if (event.tags) event.tags = scrubRecord(event.tags) ?? {};
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    delete event.request.query_string;
    delete event.request.cookies;
    if (event.request.headers) {
      event.request.headers = Object.fromEntries(
        Object.entries(redactForTelemetry(event.request.headers) as Record<string, string>).map(([k, v]) => [
          k,
          typeof v === "string" ? scrubUrl(v) : v,
        ]),
      );
    }
    if (event.request.data) {
      event.request.data = redactForTelemetry(event.request.data) as string | Record<string, unknown>;
    }
  }
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b));
  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrubUrl(span.description);
    if (span.data) span.data = scrubRecord(span.data) ?? {};
  }
  return event;
}

export function tracesSampleRateForEnvironment(environment: string): number {
  if (environment === "production") return 0.15;
  if (environment === "staging") return 0.1;
  return 0.05;
}

export function sentryEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";
}

export function sentryReleaseFallback(): string | undefined {
  // NEXT_PUBLIC_SENTRY_RELEASE is set by next.config.ts (same name the source maps were uploaded under).
  return (
    process.env.SENTRY_RELEASE?.trim() ||
    process.env.NEXT_PUBLIC_SENTRY_RELEASE?.trim() ||
    process.env.npm_package_version?.trim() ||
    undefined
  );
}

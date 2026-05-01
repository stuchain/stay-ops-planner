import { redactForTelemetry } from "@stay-ops/shared/observability/redact";

/** Minimal Sentry event shape for `beforeSend` scrubbing (avoids direct `@sentry/core` dependency). */
export type ScrubbableSentryEvent = {
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  request?: { data?: unknown };
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
};

function scrubRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return redactForTelemetry(value) as Record<string, unknown>;
}

/**
 * Applied in Sentry `beforeSend` for all Next runtimes (server, client, edge).
 */
export function scrubSentryEvent<T extends ScrubbableSentryEvent>(event: T): T {
  if (event.extra) event.extra = scrubRecord(event.extra) ?? {};
  if (event.contexts) event.contexts = scrubRecord(event.contexts) ?? {};
  if (event.request?.data) {
    event.request.data = redactForTelemetry(event.request.data) as string | Record<string, unknown>;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      data: b.data ? (redactForTelemetry(b.data) as Record<string, unknown>) : b.data,
    }));
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
  return process.env.SENTRY_RELEASE?.trim() || process.env.npm_package_version?.trim() || undefined;
}

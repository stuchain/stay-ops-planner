import * as Sentry from "@sentry/node";
import { redactForTelemetry } from "@stay-ops/shared/observability/redact";

export function initWorkerSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";
  const release = process.env.SENTRY_RELEASE?.trim();

  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.extra) {
        event.extra = redactForTelemetry(event.extra) as typeof event.extra;
      }
      if (event.contexts) {
        event.contexts = redactForTelemetry(event.contexts) as typeof event.contexts;
      }
      return event;
    },
  });
}

export { Sentry };

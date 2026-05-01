import * as Sentry from "@sentry/nextjs";
import {
  scrubSentryEvent,
  sentryEnvironment,
  sentryReleaseFallback,
  tracesSampleRateForEnvironment,
} from "./sentry.common";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
const environment = sentryEnvironment();

Sentry.init({
  dsn: dsn || undefined,
  environment,
  release: sentryReleaseFallback(),
  tracesSampleRate: tracesSampleRateForEnvironment(environment),
  sendDefaultPii: false,
  beforeSend(event) {
    return scrubSentryEvent(event);
  },
});

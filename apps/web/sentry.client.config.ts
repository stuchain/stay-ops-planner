import * as Sentry from "@sentry/nextjs";
import {
  scrubBreadcrumb,
  scrubSentryEvent,
  sentryEnvironment,
  sentryReleaseFallback,
  tracesSampleRateForEnvironment,
} from "./sentry.common";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
const environment = sentryEnvironment();
const release = sentryReleaseFallback();

Sentry.init({
  ...(dsn ? { dsn } : {}),
  environment,
  ...(release !== undefined ? { release } : {}),
  tracesSampleRate: tracesSampleRateForEnvironment(environment),
  sendDefaultPii: false,
  beforeSend(event) {
    return scrubSentryEvent(event);
  },
  beforeSendTransaction(event) {
    return scrubSentryEvent(event);
  },
  beforeBreadcrumb(breadcrumb) {
    return scrubBreadcrumb(breadcrumb);
  },
});

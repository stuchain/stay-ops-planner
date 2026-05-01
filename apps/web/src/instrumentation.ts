import { parseEnv } from "@stay-ops/shared";
import { captureRequestError } from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    parseEnv(process.env);
    await import("../sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/** Next.js hook for RSC / nested request errors — forwarded to Sentry (SDK v9+). */
export const onRequestError = captureRequestError;

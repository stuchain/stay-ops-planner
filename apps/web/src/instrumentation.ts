import { parseEnv } from "@stay-ops/shared";
import { captureRequestError } from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    /** Vercel / CI often omit production secrets during `next build`; `parseEnv` would `exit(1)` and kill the whole build (exit code 1, almost no logs). Runtime gets full env separately. See `SKIP_STAYOPS_ENV_VALIDATE` in apps/web/vercel.json build env. */
    if (process.env.SKIP_STAYOPS_ENV_VALIDATE === "1") {
      console.warn(
        "[stayops] SKIP_STAYOPS_ENV_VALIDATE=1 — skipping strict env parse in this Node process.",
      );
    } else {
      parseEnv(process.env);
    }
    await import("../sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/** Next.js hook for RSC / nested request errors — forwarded to Sentry (SDK v9+). */
export const onRequestError = captureRequestError;

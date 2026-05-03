import { z } from "zod";

function emptyToUndefined(value: unknown): unknown {
  if (value === "" || value === undefined) return undefined;
  return value;
}

const postgresUrl = z.string().refine(
  (s) => {
    try {
      const u = new URL(s);
      return u.protocol === "postgresql:" || u.protocol === "postgres:";
    } catch {
      return false;
    }
  },
  { message: "Must be a postgresql:// or postgres:// URL" },
);

export const EnvSchema = z.object({
  DATABASE_URL: postgresUrl,
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  /** Cookie `Secure` flag: auto = production only; true/false override. */
  SESSION_COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
  APP_TIMEZONE: z.string().min(1, "APP_TIMEZONE is required"),
  REDIS_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  HOSTHUB_API_BASE: z.preprocess(
    (v) =>
      v === "" || v === undefined ? "https://app.hosthub.com/api/2019-03-01" : v,
    z.string().url(),
  ),
  HOSTHUB_API_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** Path after API base for listing calendar events (see vendor hosthub-api.md). Default in client is `/calendar-events`. */
  HOSTHUB_API_RESERVATIONS_PATH: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** First calendar-events page: Hosthub `is_visible` (e.g. `all`). */
  HOSTHUB_CALENDAR_EVENTS_IS_VISIBLE: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** When `1` or `true`, reconcile omits incremental updated_gte (full visible history pull). */
  HOSTHUB_RECONCILE_FULL_SYNC: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** When `0` or `false`, skip calendar-event notes + GR-tax fetches per booking during reconcile. */
  HOSTHUB_SYNC_FETCH_EVENT_ENRICHMENT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** When `1` or `true`, reconcile also walks `GET /rentals/{id}/calendar-events` per rental (high API load). */
  HOSTHUB_RECONCILE_PER_RENTAL_CALENDAR: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** Override webhook HMAC header name if Hosthub docs specify a different name than `x-hosthub-signature`. */
  HOSTHUB_WEBHOOK_SIGNATURE_HEADER: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Server-side Sentry DSN (omit to disable sending). */
  SENTRY_DSN: z.preprocess(emptyToUndefined, z.string().url().optional()),
  /** Client-side DSN (public; omit to disable browser sending). */
  NEXT_PUBLIC_SENTRY_DSN: z.preprocess(emptyToUndefined, z.string().url().optional()),
  /** Overrides NODE_ENV for Sentry environment tag (e.g. staging). */
  SENTRY_ENVIRONMENT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** Semantic release id attached to every event (CI should set this). */
  SENTRY_RELEASE: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** Optional extra entropy for `hashUserId` (recommended in production). */
  SENTRY_USER_ID_PEPPER: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** When `1`, production builds should configure Sentry DSN (enforced in CI workflows, not parseEnv). */
  STAYOPS_SENTRY_REQUIRED: z.preprocess(emptyToUndefined, z.enum(["0", "1"]).optional()),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  const flat = parsed.error.flatten();
  const fields: { field: string; message: string }[] = [];
  for (const [key, messages] of Object.entries(flat.fieldErrors)) {
    if (messages && messages.length > 0) {
      fields.push({ field: key, message: messages.join("; ") });
    }
  }
  if (flat.formErrors.length > 0) {
    fields.push({ field: "_root", message: flat.formErrors.join("; ") });
  }
  console.error("Invalid environment configuration", JSON.stringify({ errors: fields }));
  process.exit(1);
}

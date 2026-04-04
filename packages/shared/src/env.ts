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
  APP_TIMEZONE: z.string().min(1, "APP_TIMEZONE is required"),
  REDIS_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  HOSTHUB_API_BASE: z.preprocess(
    (v) =>
      v === "" || v === undefined ? "https://app.hosthub.com/api/2019-03-01" : v,
    z.string().url(),
  ),
  HOSTHUB_API_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** Path segment after API base for listing reservations (see https://www.hosthub.com/docs/api/). Default `/reservations`. */
  HOSTHUB_API_RESERVATIONS_PATH: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** Override webhook HMAC header name if Hosthub docs specify a different name than `x-hosthub-signature`. */
  HOSTHUB_WEBHOOK_SIGNATURE_HEADER: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
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

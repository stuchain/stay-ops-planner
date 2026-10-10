import { z } from "zod";
import { sha256HexUtf8 } from "./signature.js";

const WebhookBodyStubSchema = z
  .object({
    id: z.string().min(1).optional(),
    eventId: z.string().min(1).optional(),
  })
  .passthrough();

export type HosthubWebhookBodyStub = z.infer<typeof WebhookBodyStubSchema>;

export function parseHosthubWebhookJson(rawBody: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(rawBody) as unknown };
  } catch {
    return { ok: false };
  }
}

export function parseWebhookBodyStub(parsed: unknown): { ok: true; data: HosthubWebhookBodyStub } | { ok: false } {
  const r = WebhookBodyStubSchema.safeParse(parsed);
  if (!r.success) {
    return { ok: false };
  }
  return { ok: true, data: r.data };
}

/**
 * Dedupe on the whole body: Hosthub sends a new delivery for each change of the same event (same
 * `id`, newer `updated`), and each one must be applied. Only an identical re-delivery is skipped.
 */
// `parsed` is kept for callers; the key no longer depends on the event id.
export function computeWebhookDedupeKey(_parsed: unknown, rawBody: string): string {
  return sha256HexUtf8(rawBody);
}

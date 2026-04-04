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

export function computeWebhookDedupeKey(parsed: unknown, rawBody: string): string {
  const stub = parseWebhookBodyStub(parsed);
  if (stub.ok) {
    if (stub.data.id) return stub.data.id;
    if (stub.data.eventId) return stub.data.eventId;
  }
  return sha256HexUtf8(rawBody);
}

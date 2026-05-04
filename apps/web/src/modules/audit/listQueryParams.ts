import { z } from "zod";

const FromDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const ToDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .transform((s) => new Date(`${s}T23:59:59.999Z`));

export const AuditEventsQuerySchema = z.object({
  entityType: z.string().min(1).optional(),
  bookingId: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
  actorUserId: z.string().min(1).optional(),
  from: FromDateOnly.optional(),
  to: ToDateOnly.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export type AuditEventsQuery = z.infer<typeof AuditEventsQuerySchema>;

export function defaultAuditFrom(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function defaultAuditTo(): Date {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export function parseAuditEventsQuery(url: URL): { ok: true; data: AuditEventsQuery } | { ok: false; error: z.ZodError } {
  const parsed = AuditEventsQuerySchema.safeParse({
    entityType: url.searchParams.get("entityType") || undefined,
    bookingId: url.searchParams.get("bookingId") || undefined,
    roomId: url.searchParams.get("roomId") || undefined,
    actorUserId: url.searchParams.get("actorUserId") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
    limit: url.searchParams.get("limit") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, data: parsed.data };
}

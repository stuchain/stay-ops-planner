import type { NextRequest } from "next/server";
import { respondAuthError } from "@/lib/apiError";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { listAuditEvents } from "@/modules/audit/queries";

const FromDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const ToDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .transform((s) => new Date(`${s}T23:59:59.999Z`));

const QuerySchema = z.object({
  entityType: z.string().min(1).optional(),
  bookingId: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
  actorUserId: z.string().min(1).optional(),
  from: FromDateOnly.optional(),
  to: ToDateOnly.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

function defaultFrom(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function defaultTo(): Date {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export async function GET(request: NextRequest) {
  try {
    await requireOperatorOrAdmin(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
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
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "Invalid query", parsed.error.flatten()),
      { status: 400 },
    );
  }

  const from = parsed.data.from ?? defaultFrom();
  const to = parsed.data.to ?? defaultTo();
  if (from > to) {
    return NextResponse.json(jsonError("VALIDATION_ERROR", "from must be <= to"), { status: 400 });
  }

  const result = await listAuditEvents({
    entityType: parsed.data.entityType,
    bookingId: parsed.data.bookingId,
    roomId: parsed.data.roomId,
    actorUserId: parsed.data.actorUserId,
    from,
    to,
    cursor: parsed.data.cursor,
    limit: parsed.data.limit ?? 20,
  });

  return NextResponse.json({
    data: result.data,
    page: {
      nextCursor: result.nextCursor,
      limit: parsed.data.limit ?? 20,
    },
  });
}

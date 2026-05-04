import type { NextRequest } from "next/server";
import { apiError, attachTraceToResponse, respondAuthError } from "@/lib/apiError";
import { NextResponse } from "next/server";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { listAuditEvents } from "@/modules/audit/queries";
import { defaultAuditFrom, defaultAuditTo, parseAuditEventsQuery } from "@/modules/audit/listQueryParams";

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
  const parsed = parseAuditEventsQuery(url);
  if (!parsed.ok) {
    return attachTraceToResponse(
      request,
      NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid query", parsed.error.flatten()), { status: 400 }),
    );
  }

  const from = parsed.data.from ?? defaultAuditFrom();
  const to = parsed.data.to ?? defaultAuditTo();
  if (from > to) {
    return attachTraceToResponse(request, apiError(request, "VALIDATION_ERROR", "from must be <= to", 400));
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

  return attachTraceToResponse(
    request,
    NextResponse.json({
      data: result.data,
      page: {
        nextCursor: result.nextCursor,
        limit: parsed.data.limit ?? 20,
      },
    }),
  );
}

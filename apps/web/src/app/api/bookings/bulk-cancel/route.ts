import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { attachTraceToResponse, respondAuthError } from "@/lib/apiError";
import { withIdempotency } from "@/lib/idempotency";
import { DEFAULT_USER_RATE_RULES, withRateLimit } from "@/lib/rateLimit";
import { readTraceId } from "@/lib/traceId";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { BulkCancelBookingsError, bulkCancelBookings } from "@/modules/bookings/bulkCancelService";
import { log } from "@stay-ops/shared";

const PostBodySchema = z
  .object({
    bookingIds: z.array(z.string().min(1)).min(1).max(200),
    dryRun: z.boolean().optional(),
  })
  .strict();

function parseDryRun(request: NextRequest, bodyDry?: boolean): boolean {
  if (request.nextUrl.searchParams.get("dryRun") === "true") return true;
  return Boolean(bodyDry);
}

async function postBookingsBulkCancel(request: NextRequest) {
  try {
    const ctx = await requireOperatorOrAdmin(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid request body"), { status: 400 });
    }

    const parsed = PostBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        jsonError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
        { status: 400 },
      );
    }

    const dryRun = parseDryRun(request, parsed.data.dryRun);

    try {
      const out = await bulkCancelBookings({
        bookingIds: parsed.data.bookingIds,
        actorUserId: ctx.userId,
        auditMeta: auditMetaFromRequest(request),
        dryRun,
      });

      if (out.dryRun) {
        log("info", "dry_run", {
          route: "/api/bookings/bulk-cancel",
          dryRun: true,
          traceId: readTraceId(request),
          processed: out.summary.totals.processed,
        });
        return attachTraceToResponse(
          request,
          NextResponse.json({ data: { dryRun: true, summary: out.summary } }, { status: 200 }),
        );
      }

      return attachTraceToResponse(
        request,
        NextResponse.json({ data: { dryRun: false, cancelledIds: out.cancelledIds } }, { status: 200 }),
      );
    } catch (err) {
      if (err instanceof BulkCancelBookingsError) {
        return attachTraceToResponse(
          request,
          NextResponse.json(jsonError(err.code, err.message, err.details, readTraceId(request) ?? ""), {
            status: err.status,
          }),
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }
}

export async function POST(request: NextRequest) {
  return withRateLimit("POST:/api/bookings/bulk-cancel", DEFAULT_USER_RATE_RULES, request, (req) =>
    withIdempotency("POST:/api/bookings/bulk-cancel", req as NextRequest, postBookingsBulkCancel),
  );
}

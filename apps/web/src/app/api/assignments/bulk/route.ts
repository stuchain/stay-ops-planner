import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { attachTraceToResponse, respondAuthError } from "@/lib/apiError";
import { withIdempotency } from "@/lib/idempotency";
import { DEFAULT_USER_RATE_RULES, withRateLimit } from "@/lib/rateLimit";
import { readTraceId } from "@/lib/traceId";
import { AllocationError, allocationErrorEnvelope } from "@/modules/allocation/errors";
import { bulkAssignBookings } from "@/modules/allocation/service";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { log } from "@stay-ops/shared";

const ItemSchema = z.object({
  bookingId: z.string().min(1),
  roomId: z.string().min(1),
});

const PostBodySchema = z
  .object({
    items: z.array(ItemSchema).min(1).max(200),
    dryRun: z.boolean().optional(),
  })
  .strict();

function assignmentDto(a: {
  id: string;
  bookingId: string;
  roomId: string;
  startDate: Date;
  endDate: Date;
  version: number;
}) {
  return {
    id: a.id,
    bookingId: a.bookingId,
    roomId: a.roomId,
    startDate: a.startDate.toISOString().slice(0, 10),
    endDate: a.endDate.toISOString().slice(0, 10),
    version: a.version,
  };
}

function parseDryRun(request: NextRequest, bodyDry?: boolean): boolean {
  if (request.nextUrl.searchParams.get("dryRun") === "true") return true;
  return Boolean(bodyDry);
}

async function postAssignmentsBulk(request: NextRequest) {
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
      const out = await bulkAssignBookings({
        items: parsed.data.items,
        actorUserId: ctx.userId,
        auditMeta: auditMetaFromRequest(request),
        dryRun,
      });

      if (out.dryRun) {
        log("info", "dry_run", {
          route: "/api/assignments/bulk",
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
        NextResponse.json(
          {
            data: {
              dryRun: false,
              assignments: out.results.map((r) => ({
                assignment: assignmentDto(r.assignment),
                auditRef: r.auditRef,
              })),
            },
          },
          { status: 201 },
        ),
      );
    } catch (err) {
      if (err instanceof AllocationError) {
        return attachTraceToResponse(
          request,
          NextResponse.json(allocationErrorEnvelope(err, readTraceId(request)), { status: err.status }),
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
  return withRateLimit("POST:/api/assignments/bulk", DEFAULT_USER_RATE_RULES, request, (req) =>
    withIdempotency("POST:/api/assignments/bulk", req as NextRequest, postAssignmentsBulk),
  );
}

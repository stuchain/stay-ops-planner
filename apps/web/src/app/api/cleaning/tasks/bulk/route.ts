import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { CleaningWindowInvalidError } from "@stay-ops/db";
import { attachTraceToResponse, respondAuthError } from "@/lib/apiError";
import { withIdempotency } from "@/lib/idempotency";
import { DEFAULT_USER_RATE_RULES, withRateLimit } from "@/lib/rateLimit";
import { readTraceId } from "@/lib/traceId";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import {
  bulkCreateServiceCleaningTasks,
  type ServiceCleaningTaskApiResult,
} from "@/modules/cleaning/taskSchedule";
import { cleaningErrorEnvelope, CleaningBookingNotFoundError, InvalidStateTransitionError } from "@/modules/cleaning/errors";
import { log } from "@stay-ops/shared";

const ItemSchema = z
  .object({
    bookingId: z.string().min(1),
    roomId: z.string().min(1),
    sourceEventId: z.string().min(1).optional(),
    plannedStart: z.string().optional(),
  })
  .strict();

const PostBodySchema = z
  .object({
    items: z.array(ItemSchema).min(1).max(200),
    dryRun: z.boolean().optional(),
  })
  .strict();

function taskDto(t: ServiceCleaningTaskApiResult["task"]) {
  return {
    id: t.id,
    bookingId: t.bookingId,
    roomId: t.roomId,
    status: t.status,
    taskType: t.taskType,
    plannedStart: t.plannedStart?.toISOString() ?? null,
    plannedEnd: t.plannedEnd?.toISOString() ?? null,
    assigneeName: t.assigneeName,
    durationMinutes: t.durationMinutes,
  };
}

function parseDryRun(request: NextRequest, bodyDry?: boolean): boolean {
  if (request.nextUrl.searchParams.get("dryRun") === "true") return true;
  return Boolean(bodyDry);
}

async function postCleaningTasksBulk(request: NextRequest) {
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
      const out = await bulkCreateServiceCleaningTasks({
        items: parsed.data.items,
        actorUserId: ctx.userId,
        auditMeta: auditMetaFromRequest(request),
        dryRun,
      });

      if (out.dryRun) {
        log("info", "dry_run", {
          route: "/api/cleaning/tasks/bulk",
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
              tasks: out.results.map((r) => ({ task: taskDto(r.task), created: r.created })),
            },
          },
          { status: 201 },
        ),
      );
    } catch (err) {
      if (err instanceof CleaningBookingNotFoundError) {
        return attachTraceToResponse(
          request,
          NextResponse.json(
            cleaningErrorEnvelope(
              {
                code: err.code,
                message: err.message,
                status: err.status,
                details: err.details,
              },
              readTraceId(request) ?? "",
            ),
            { status: err.status },
          ),
        );
      }
      if (err instanceof InvalidStateTransitionError) {
        return attachTraceToResponse(
          request,
          NextResponse.json(
            cleaningErrorEnvelope(
              { code: err.code, message: err.message, status: err.status },
              readTraceId(request) ?? "",
            ),
            { status: err.status },
          ),
        );
      }
      if (err instanceof CleaningWindowInvalidError) {
        return attachTraceToResponse(
          request,
          NextResponse.json(
            cleaningErrorEnvelope(
              { code: err.code, message: err.message, status: err.status },
              readTraceId(request) ?? "",
            ),
            { status: err.status },
          ),
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
  return withRateLimit("POST:/api/cleaning/tasks/bulk", DEFAULT_USER_RATE_RULES, request, (req) =>
    withIdempotency("POST:/api/cleaning/tasks/bulk", req as NextRequest, postCleaningTasksBulk),
  );
}

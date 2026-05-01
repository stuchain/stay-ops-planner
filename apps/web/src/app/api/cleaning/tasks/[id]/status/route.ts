import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  cleaningErrorEnvelope,
  CleaningTaskNotFoundError,
  InvalidStateTransitionError,
} from "@/modules/cleaning/errors";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { transitionCleaningTaskStatus } from "@/modules/cleaning/state-machine";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { readTraceId } from "@/lib/traceId";
import { AuthError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";

const PatchBodySchema = z
  .object({
    status: z.enum(["in_progress", "done"]),
  })
  .strict();

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireOperatorOrAdmin(request);
    const { id } = await ctx.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(request, "VALIDATION_ERROR", "Invalid request body", 400);
    }

    const parsed = PatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(request, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    }

    try {
      await transitionCleaningTaskStatus({
        taskId: id,
        toStatus: parsed.data.status,
        actorUserId: session.userId,
        auditMeta: auditMetaFromRequest(request),
      });
      return attachTraceToResponse(request, NextResponse.json({ data: { ok: true } }, { status: 200 }));
    } catch (err) {
      const tid = readTraceId(request);
      if (err instanceof CleaningTaskNotFoundError) {
        return attachTraceToResponse(
          request,
          NextResponse.json(
            cleaningErrorEnvelope(
              { code: err.code, message: err.message, status: err.status },
              tid,
            ),
            { status: err.status },
          ),
        );
      }
      if (err instanceof InvalidStateTransitionError) {
        return attachTraceToResponse(
          request,
          NextResponse.json(cleaningErrorEnvelope(err, tid), { status: err.status }),
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(request, err.code, err.message, err.status, err.details);
    }
    throw err;
  }
}

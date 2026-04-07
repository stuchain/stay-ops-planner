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
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";

const PatchBodySchema = z
  .object({
    status: z.enum(["in_progress", "done"]),
  })
  .strict();

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = requireAdminSession(request);
    const { id } = await ctx.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid request body"), { status: 400 });
    }

    const parsed = PatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        jsonError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
        { status: 400 },
      );
    }

    try {
      await transitionCleaningTaskStatus({
        taskId: id,
        toStatus: parsed.data.status,
        actorUserId: session.userId,
        auditMeta: auditMetaFromRequest(request),
      });
      return NextResponse.json({ data: { ok: true } }, { status: 200 });
    } catch (err) {
      if (err instanceof CleaningTaskNotFoundError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: err.status },
        );
      }
      if (err instanceof InvalidStateTransitionError) {
        return NextResponse.json(cleaningErrorEnvelope(err), { status: err.status });
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }
}

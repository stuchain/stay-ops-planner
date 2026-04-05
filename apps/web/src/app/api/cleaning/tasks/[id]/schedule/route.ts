import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { CleaningWindowInvalidError } from "@stay-ops/db";
import {
  cleaningErrorEnvelope,
  CleaningTaskNotFoundError,
} from "../../../../../../modules/cleaning/errors";
import { updateCleaningTaskSchedule } from "../../../../../../modules/cleaning/taskSchedule";
import { AuthError, jsonError } from "../../../../../../modules/auth/errors";
import { requireAdminSession } from "../../../../../../modules/auth/guard";

const PatchBodySchema = z
  .object({
    plannedStart: z.string().min(1),
    plannedEnd: z.string().min(1),
    assigneeName: z.string().nullable().optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAdminSession(request);
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

    const plannedStart = new Date(parsed.data.plannedStart);
    const plannedEnd = new Date(parsed.data.plannedEnd);
    if (Number.isNaN(plannedStart.getTime()) || Number.isNaN(plannedEnd.getTime())) {
      return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid datetime"), { status: 400 });
    }

    try {
      await updateCleaningTaskSchedule({
        taskId: id,
        plannedStart,
        plannedEnd,
        assigneeName: parsed.data.assigneeName,
      });
      return NextResponse.json({ data: { ok: true } }, { status: 200 });
    } catch (err) {
      if (err instanceof CleaningTaskNotFoundError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: err.status },
        );
      }
      if (err instanceof CleaningWindowInvalidError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: err.status },
        );
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

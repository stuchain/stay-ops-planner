import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { attachTraceToResponse, respondAuthError } from "@/lib/apiError";
import { readTraceId } from "@/lib/traceId";
import { AllocationError, allocationErrorEnvelope } from "@/modules/allocation/errors";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import {
  BlockNotFoundError,
  InvalidBlockRangeError,
  ManualBlockService,
} from "@/modules/blocks/service";

const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const PatchBodySchema = z
  .object({
    startDate: DateOnly.optional(),
    endDate: DateOnly.optional(),
    reason: z.string().optional().nullable(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field required" });

function blockToDto(block: {
  id: string;
  roomId: string;
  startDate: Date;
  endDate: Date;
  reason: string | null;
}) {
  return {
    id: block.id,
    roomId: block.roomId,
    startDate: block.startDate.toISOString().slice(0, 10),
    endDate: block.endDate.toISOString().slice(0, 10),
    reason: block.reason,
  };
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let sessionUserId = "";
  try {
    sessionUserId = (await requireOperatorOrAdmin(request)).userId;
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

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
    const block = await ManualBlockService.update(id, {
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      reason: parsed.data.reason,
      actorUserId: sessionUserId,
      auditMeta: auditMetaFromRequest(request),
    });
    return NextResponse.json({ data: blockToDto(block) }, { status: 200 });
  } catch (err) {
    if (err instanceof AllocationError) {
      return attachTraceToResponse(
        request,
        NextResponse.json(allocationErrorEnvelope(err, readTraceId(request)), { status: err.status }),
      );
    }
    if (err instanceof BlockNotFoundError) {
      return NextResponse.json(jsonError("NOT_FOUND", err.message, { blockId: err.blockId }), {
        status: 404,
      });
    }
    if (err instanceof InvalidBlockRangeError) {
      return NextResponse.json(jsonError(err.code, err.message), { status: err.status });
    }
    throw err;
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let sessionUserId = "";
  try {
    sessionUserId = (await requireOperatorOrAdmin(request)).userId;
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  const { id } = await ctx.params;

  try {
    await ManualBlockService.delete(id, sessionUserId, auditMetaFromRequest(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof BlockNotFoundError) {
      return NextResponse.json(jsonError("NOT_FOUND", err.message, { blockId: err.blockId }), {
        status: 404,
      });
    }
    throw err;
  }
}

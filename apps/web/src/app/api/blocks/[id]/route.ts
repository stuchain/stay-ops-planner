import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AllocationError, allocationErrorEnvelope } from "../../../../../modules/allocation/errors";
import { AuthError, jsonError } from "../../../../../modules/auth/errors";
import { requireAdminSession } from "../../../../../modules/auth/guard";
import {
  BlockNotFoundError,
  InvalidBlockRangeError,
  deleteManualBlock,
  updateManualBlock,
} from "../../../../../modules/blocks/service";

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
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
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
    const block = await updateManualBlock(id, {
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ data: blockToDto(block) }, { status: 200 });
  } catch (err) {
    if (err instanceof AllocationError) {
      return NextResponse.json(allocationErrorEnvelope(err), { status: err.status });
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
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  const { id } = await ctx.params;

  try {
    await deleteManualBlock(id);
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

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AllocationError, allocationErrorEnvelope } from "@/modules/allocation/errors";
import { assignBookingToRoom } from "@/modules/allocation/service";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";

const PostBodySchema = z
  .object({
    expectedVersion: z.number().int().optional(),
  })
  .optional();

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

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; roomId: string }> },
) {
  try {
    const session = requireAdminSession(request);
    const { id, roomId } = await ctx.params;
    let body: unknown = undefined;
    try {
      const raw = await request.text();
      if (raw.trim().length > 0) {
        body = JSON.parse(raw);
      }
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
    try {
      const result = await assignBookingToRoom({
        bookingId: id,
        roomId,
        actorUserId: session.userId,
        auditMeta: auditMetaFromRequest(request),
      });
      return NextResponse.json(
        {
          data: {
            assignment: assignmentDto(result.assignment),
            auditRef: result.auditRef,
          },
        },
        { status: 200 },
      );
    } catch (err) {
      if (err instanceof AllocationError) {
        return NextResponse.json(allocationErrorEnvelope(err), { status: err.status });
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

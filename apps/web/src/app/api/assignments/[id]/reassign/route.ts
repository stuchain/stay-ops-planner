import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AllocationError, allocationErrorEnvelope } from "../../../../../modules/allocation/errors";
import { reassignRoom } from "../../../../../modules/allocation/service";
import { AuthError, jsonError } from "../../../../../modules/auth/errors";
import { requireAdminSession } from "../../../../../modules/auth/guard";

const PatchBodySchema = z.object({
  roomId: z.string().min(1),
  expectedVersion: z.number().int(),
});

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
      const result = await reassignRoom({
        assignmentId: id,
        roomId: parsed.data.roomId,
        expectedVersion: parsed.data.expectedVersion,
        actorUserId: session.userId,
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

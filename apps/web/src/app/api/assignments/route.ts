import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AllocationError, allocationErrorEnvelope } from "../../../../modules/allocation/errors";
import { assignBookingToRoom } from "../../../../modules/allocation/service";
import { AuthError, jsonError } from "../../../../modules/auth/errors";
import { requireAdminSession } from "../../../../modules/auth/guard";

const PostBodySchema = z.object({
  bookingId: z.string().min(1),
  roomId: z.string().min(1),
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

export async function POST(request: NextRequest) {
  try {
    const ctx = requireAdminSession(request);
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

    try {
      const result = await assignBookingToRoom({
        bookingId: parsed.data.bookingId,
        roomId: parsed.data.roomId,
        actorUserId: ctx.userId,
      });
      return NextResponse.json(
        {
          data: {
            assignment: assignmentDto(result.assignment),
            auditRef: result.auditRef,
          },
        },
        { status: 201 },
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

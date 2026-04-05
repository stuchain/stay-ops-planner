import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AllocationError, allocationErrorEnvelope } from "../../../../modules/allocation/errors";
import { requireAdminSession } from "../../../../modules/auth/guard";
import { AuthError, jsonError } from "../../../../modules/auth/errors";
import { ManualBlockService } from "../../../../modules/blocks/service";

const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const PostBodySchema = z
  .object({
    roomId: z.string().min(1),
    startDate: DateOnly,
    endDate: DateOnly,
    reason: z.string().optional().nullable(),
  })
  .refine((b) => b.startDate < b.endDate, {
    message: "startDate must be strictly before endDate",
    path: ["startDate"],
  });

export async function POST(request: NextRequest) {
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

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
    const block = await ManualBlockService.create({
      roomId: parsed.data.roomId,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      reason: parsed.data.reason,
    });
    return NextResponse.json(
      {
        data: {
          id: block.id,
          roomId: block.roomId,
          startDate: block.startDate.toISOString().slice(0, 10),
          endDate: block.endDate.toISOString().slice(0, 10),
          reason: block.reason,
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
}

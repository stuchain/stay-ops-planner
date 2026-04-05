import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AllocationError, allocationErrorEnvelope } from "../../../../../modules/allocation/errors";
import { unassignBooking } from "../../../../../modules/allocation/service";
import { AuthError, jsonError } from "../../../../../modules/auth/errors";
import { requireAdminSession } from "../../../../../modules/auth/guard";

const PostBodySchema = z.object({
  expectedVersion: z.number().int(),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = requireAdminSession(request);
    const { id } = await ctx.params;

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
      const result = await unassignBooking({
        assignmentId: id,
        expectedVersion: parsed.data.expectedVersion,
        actorUserId: session.userId,
      });
      return NextResponse.json({ data: { ok: true, auditRef: result.auditRef } }, { status: 200 });
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

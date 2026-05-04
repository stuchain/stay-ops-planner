import type { NextRequest } from "next/server";
import { respondAuthError } from "@/lib/apiError";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { ExcelListingNotFoundError, patchExcelListingRentalIndex } from "@/modules/excel/excelAuditMutations";

const PatchBodySchema = z
  .object({
    rentalIndex: z.union([z.null(), z.number().int().min(1).max(4)]),
  })
  .strict();

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireOperatorOrAdmin(request);
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
    return NextResponse.json(jsonError("BAD_REQUEST", "Invalid JSON"), { status: 400 });
  }

  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(jsonError("BAD_REQUEST", "Invalid body", parsed.error.flatten()), {
      status: 400,
    });
  }

  try {
    const updated = await patchExcelListingRentalIndex({
      listingId: id,
      rentalIndex: parsed.data.rentalIndex,
      actorUserId: session.userId,
      auditMeta: auditMetaFromRequest(request),
    });
    return NextResponse.json({
      data: {
        id: updated.id,
        channel: updated.channel,
        title: updated.title,
        externalListingId: updated.externalListingId,
        rentalIndex: updated.rentalIndex,
      },
    });
  } catch (err) {
    if (err instanceof ExcelListingNotFoundError) {
      return NextResponse.json(jsonError("NOT_FOUND", "Listing not found"), { status: 404 });
    }
    throw err;
  }
}

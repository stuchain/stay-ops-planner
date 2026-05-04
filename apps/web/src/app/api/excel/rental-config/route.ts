import type { NextRequest } from "next/server";
import { respondAuthError } from "@/lib/apiError";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { patchExcelRentalConfigLabel } from "@/modules/excel/excelAuditMutations";
import { getOrCreateExcelRentalConfig } from "@/modules/excel/rentalConfig";
import { prisma } from "@/lib/prisma";

const PatchBodySchema = z
  .object({
    index: z.number().int().min(1).max(4),
    label: z.string().trim().min(1).max(120),
  })
  .strict();

export async function GET(request: NextRequest) {
  try {
    await requireOperatorOrAdmin(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  const data = await getOrCreateExcelRentalConfig(prisma);
  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  let session;
  try {
    session = await requireOperatorOrAdmin(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

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

  const { index, label } = parsed.data;
  const updated = await patchExcelRentalConfigLabel({
    index: index as 1 | 2 | 3 | 4,
    label,
    actorUserId: session.userId,
    auditMeta: auditMetaFromRequest(request),
  });

  return NextResponse.json({
    data: {
      label1: updated.label1,
      label2: updated.label2,
      label3: updated.label3,
      label4: updated.label4,
    },
  });
}

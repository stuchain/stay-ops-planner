import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import { getOrCreateExcelRentalConfig } from "@/modules/excel/rentalConfig";

const PatchBodySchema = z
  .object({
    index: z.number().int().min(1).max(4),
    label: z.string().trim().min(1).max(120),
  })
  .strict();

export async function GET(request: NextRequest) {
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  const data = await getOrCreateExcelRentalConfig(prisma);
  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
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
    return NextResponse.json(jsonError("BAD_REQUEST", "Invalid JSON"), { status: 400 });
  }

  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(jsonError("BAD_REQUEST", "Invalid body", parsed.error.flatten()), {
      status: 400,
    });
  }

  await getOrCreateExcelRentalConfig(prisma);
  const { index, label } = parsed.data;
  const data =
    index === 1
      ? { label1: label }
      : index === 2
        ? { label2: label }
        : index === 3
          ? { label3: label }
          : { label4: label };
  const updated = await prisma.excelRentalConfig.update({
    where: { id: 1 },
    data,
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

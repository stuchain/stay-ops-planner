import type { NextRequest } from "next/server";
import { respondAuthError } from "@/lib/apiError";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { getOrCreateExcelRentalConfig } from "@/modules/excel/rentalConfig";
import { loadLedgerRowsForYear } from "@/modules/excel/yearData";

const YearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireOperatorOrAdmin(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  const now = new Date();
  const defaultYear = now.getUTCFullYear();
  const parsed = YearQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(jsonError("BAD_REQUEST", "Invalid query", parsed.error.flatten()), {
      status: 400,
    });
  }
  const year = parsed.data.year ?? defaultYear;

  const [rows, rentalLabels] = await Promise.all([
    loadLedgerRowsForYear(prisma, year),
    getOrCreateExcelRentalConfig(prisma),
  ]);

  return NextResponse.json({ data: { year, rows, rentalLabels } });
}

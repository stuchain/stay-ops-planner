import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { respondAuthError } from "@/lib/apiError";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { buildLedgerWorkbook } from "@/server/money/exportLedger";
import { buildLedger } from "@/server/useCases/buildLedger";
import { todayIso } from "@/server/time";

const YearQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });

/** The year's ledger as an Excel file, built from the same ledger as the money page (E3-1). */
export async function GET(request: NextRequest) {
  try {
    await requireOperatorOrAdmin(request);
  } catch (err) {
    if (err instanceof AuthError) return respondAuthError(request, err);
    throw err;
  }
  const parsed = YearQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(jsonError("BAD_REQUEST", "Invalid query", parsed.error.flatten()), { status: 400 });
  }
  const year = parsed.data.year ?? Number(todayIso().slice(0, 4));
  const buf = await buildLedgerWorkbook(await buildLedger(year));
  const fileName = encodeURIComponent(`Έσοδα ${year}.xlsx`);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="esoda-${year}.xlsx"; filename*=UTF-8''${fileName}`,
      "Cache-Control": "no-store",
    },
  });
}

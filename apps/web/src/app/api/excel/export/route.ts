import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import { computeTotals } from "@/modules/excel/ledger";
import { getOrCreateExcelRentalConfig } from "@/modules/excel/rentalConfig";
import { displayedRow, loadLedgerRowsForYear } from "@/modules/excel/yearData";

const YearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

const MONTH_NAMES_GR = [
  "ΙΑΝΟΥΑΡΙΟΣ",
  "ΦΕΒΡΟΥΑΡΙΟΣ",
  "ΜΑΡΤΙΟΣ",
  "ΑΠΡΙΛΙΟΣ",
  "ΜΑΪΟΣ",
  "ΙΟΥΝΙΟΣ",
  "ΙΟΥΛΙΟΣ",
  "ΑΥΓΟΥΣΤΟΣ",
  "ΣΕΠΤΕΜΒΡΙΟΣ",
  "ΟΚΤΩΒΡΙΟΣ",
  "ΝΟΕΜΒΡΙΟΣ",
  "ΔΕΚΕΜΒΡΙΟΣ",
] as const;

function monthFromSortKey(sort: string | null): number {
  if (!sort || sort.length < 7) return 0;
  const m = Number(sort.slice(5, 7));
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m : 0;
}

function numCell(n: number | null | undefined): number | string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n;
}

function strCell(s: string | null | undefined): string {
  return s ?? "";
}

/** 18 columns: seq + data (matches UI). Month in passport col; sub-labels under headers; no AMA · 1–4. */
function monthBannerExportRow(monthIndex0: number): (string | number)[] {
  const label = MONTH_NAMES_GR[monthIndex0] ?? "";
  return [
    "",
    "",
    "",
    label,
    "",
    "ΗΜΕΡΕΣ",
    "",
    "AIRBNB",
    "BOOKING",
    "",
    "",
    "ΠΡΟΚ/ΛΗ",
    "ΚΑΘΑΡΟ",
    "",
    "",
    "",
    "",
    "",
  ];
}

export async function GET(request: NextRequest) {
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
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

  const [apiRows, rentalLabels] = await Promise.all([
    loadLedgerRowsForYear(prisma, year),
    getOrCreateExcelRentalConfig(prisma),
  ]);
  const displayed = apiRows.map(displayedRow);
  const totals = computeTotals(displayed);

  const header: (string | number)[] = [
    "Α/Α",
    "ΟΝΟΜΑ",
    "ΑΤΟΜΑ",
    "ΔΙΑΒΑΤΗΡΙΟ",
    "ROOM LOCATION",
    "ΑΦΙΞΗ - ΑΝΑΧΩΡΗΣΗ",
    "ΗΜΕΡΕΣ Χ ΤΙΜΗ",
    "AIRBNB ΔΩΜ ΠΟΣΟ",
    "BOOKING ΔΩΜ ΠΟΣΟ",
    "ΣΥΜΒΟ ΠΟΣΟ",
    "ΜΟΝΟΙ ΠΟΣΟ",
    "ΠΡΟΚ/ΛΗ",
    "ΚΑΘΑΡΟ",
    "ROOM AMA",
    rentalLabels.label1,
    rentalLabels.label2,
    rentalLabels.label3,
    rentalLabels.label4,
  ];

  const aoa: (string | number)[][] = [header];

  let seq = 0;
  for (let mi = 0; mi < 12; mi += 1) {
    const month = mi + 1;
    aoa.push(monthBannerExportRow(mi));

    const monthRows = apiRows.filter((r) => monthFromSortKey(r.sortCheckin) === month);
    for (const r of monthRows) {
      seq += 1;
      const d = displayedRow(r);
      aoa.push([
        seq,
        strCell(d.name),
        numCell(d.guestCount),
        strCell(d.passport),
        strCell(d.roomLocation),
        strCell(d.dateRange),
        numCell(d.nights),
        numCell(d.airbnbAmount),
        numCell(d.bookingAmount),
        numCell(d.contractAmount),
        numCell(d.soloAmount),
        numCell(d.prepayment),
        numCell(d.payoutAmount),
        numCell(d.rentalIndex),
        numCell(d.rental1),
        numCell(d.rental2),
        numCell(d.rental3),
        numCell(d.rental4),
      ]);
    }
  }

  aoa.push([]);
  aoa.push([
    ...Array(13).fill(""),
    "ΣΥΝΟΛΑ",
    totals.sumByRental[0],
    totals.sumByRental[1],
    totals.sumByRental[2],
    totals.sumByRental[3],
  ]);
  aoa.push([...Array(17).fill(""), totals.grandTotal]);
  aoa.push([
    ...Array(11).fill(""),
    "ΦΟΡΟΣ (45%)",
    "",
    "",
    "",
    "",
    "",
    totals.topBracketTax,
  ]);
  aoa.push([
    ...Array(10).fill(""),
    "ΣΥΝ J",
    totals.sumJ,
    "ΣΥΝ L",
    totals.sumL,
    "",
    "",
    "",
    "",
  ]);
  aoa.push([
    ...Array(13).fill(""),
    "ΦΟΡΟΣ 35% / ενοίκιο",
    totals.perRentalBracketTax[0],
    totals.perRentalBracketTax[1],
    totals.perRentalBracketTax[2],
    totals.perRentalBracketTax[3],
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "Φύλλο3");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const baseName = `Ημερολόγιο -${year}-.xlsx`;
  const asciiName = `calendar-${year}.xlsx`;
  const utf8Name = encodeURIComponent(baseName);

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
    },
  });
}

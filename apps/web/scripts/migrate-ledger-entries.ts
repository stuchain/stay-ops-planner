/**
 * One-off (Phase 3, P3-3): copies the old money-page corrections (`excel_ledger_entries`,
 * euros as floats, keyed by year + booking) into `ledger_entries` (cents, keyed by booking).
 *
 *   corepack pnpm --filter @stay-ops/web exec tsx --tsconfig tsconfig.json scripts/migrate-ledger-entries.ts          # report only
 *   corepack pnpm --filter @stay-ops/web exec tsx --tsconfig tsconfig.json scripts/migrate-ledger-entries.ts --apply  # write
 *
 * Safe to run again: rows already copied (same legacy id) are updated, rows corrected in the
 * new page since are left alone. Afterwards every corrected cell is compared, old page vs new,
 * and the yearly totals of both are printed side by side.
 */
import { PrismaClient, type Prisma } from "@stay-ops/db";
import { centsToEuros, type Cents } from "@stay-ops/domain";
import { convertLegacyOverrides } from "@/server/money/legacyOverrides";
import { buildLedger } from "@/server/useCases/buildLedger";
import { computeTotals } from "@/modules/excel/ledger";
import { displayedRow, loadLedgerRowsForYear } from "@/modules/excel/yearData";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const CELL_PAIRS: [oldKey: string, newKey: string][] = [
  ["airbnbAmount", "airbnbCents"],
  ["bookingAmount", "bookingCents"],
  ["contractAmount", "contractCents"],
  ["soloAmount", "soloCents"],
  ["prepayment", "prepaymentCents"],
  ["payoutAmount", "payoutCents"],
];

function euros(c: Cents | number): string {
  return centsToEuros(c as Cents).toFixed(2);
}

async function main() {
  const legacy = await prisma.excelLedgerEntry.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: { booking: { select: { checkinDate: true } } },
  });
  const existing = await prisma.ledgerEntry.findMany();
  const byLegacyId = new Map(existing.filter((e) => e.legacyEntryId).map((e) => [e.legacyEntryId!, e]));
  const byBooking = new Map(existing.filter((e) => e.bookingId).map((e) => [e.bookingId!, e]));

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  const report: string[] = [];
  const chosenForBooking = new Map<string, (typeof legacy)[number]>();

  for (const row of legacy) {
    if (!row.bookingId) continue;
    const prev = chosenForBooking.get(row.bookingId);
    const checkinYear = row.booking?.checkinDate.getUTCFullYear();
    // One entry per booking now: prefer the one for the booking's current check-in year, then the newest.
    if (!prev || (row.year === checkinYear && prev.year !== checkinYear)) chosenForBooking.set(row.bookingId, row);
  }

  let copied = 0;
  for (const row of legacy) {
    const { overrides, dropped } = convertLegacyOverrides(row.overrides);
    if (dropped.length) report.push(`entry ${row.id}: could not read ${dropped.join(", ")}`);
    const data = { overrides: overrides as Prisma.InputJsonValue, legacyEntryId: row.id };

    if (row.bookingId) {
      if (chosenForBooking.get(row.bookingId) !== row) {
        report.push(`entry ${row.id}: older duplicate for booking ${row.bookingId} (year ${row.year}), skipped`);
        continue;
      }
      const current = byBooking.get(row.bookingId);
      if (current && current.legacyEntryId !== row.id) {
        report.push(`booking ${row.bookingId}: already corrected on the new page, left alone`);
        continue;
      }
      writes.push(
        prisma.ledgerEntry.upsert({
          where: { bookingId: row.bookingId },
          create: { ...data, bookingId: row.bookingId, version: 1 },
          update: data,
        }),
      );
    } else {
      const manual = { ...data, year: row.year, month: row.manualMonth ?? 1, label: row.manualName ?? "" };
      writes.push(
        byLegacyId.has(row.id)
          ? prisma.ledgerEntry.update({ where: { legacyEntryId: row.id }, data: manual })
          : prisma.ledgerEntry.create({ data: { ...manual, version: 1 } }),
      );
    }
    copied += 1;
  }

  console.log(`${legacy.length} old entries, ${copied} to copy${apply ? "" : " (report only; pass --apply to write)"}`);
  for (const line of report) console.log(`  ${line}`);
  if (!apply) return;

  await prisma.$transaction(writes);

  // Verify: every corrected amount reads the same on the old and the new page, and compare totals.
  const years = [...new Set(legacy.map((r) => r.year))].sort();
  let mismatches = 0;
  for (const year of years) {
    const [oldRows, ledger] = await Promise.all([loadLedgerRowsForYear(prisma, year), buildLedger(year, prisma)]);
    const newByKey = new Map(ledger.rows.map((r) => [r.bookingId ?? r.entryId, r]));
    for (const old of oldRows) {
      if (!old.overrides) continue;
      const key =
        old.bookingId ?? (await prisma.ledgerEntry.findUnique({ where: { legacyEntryId: old.entryId! } }))?.id;
      const fresh = key ? newByKey.get(key) : undefined;
      if (!fresh) continue; // a booking that moved to another year: checked in that year's pass
      const shownOld = displayedRow(old) as unknown as Record<string, number | null>;
      for (const [oldKey, newKey] of CELL_PAIRS) {
        if (!(oldKey in old.overrides)) continue;
        const want = shownOld[oldKey] == null ? null : Math.round(shownOld[oldKey]! * 100);
        const got = (fresh.shown as unknown as Record<string, number | null>)[newKey] ?? null;
        if (want !== got) {
          mismatches += 1;
          console.log(`  MISMATCH ${year} ${key} ${oldKey}: old ${want} new ${got}`);
        }
      }
    }
    const oldTotals = computeTotals(oldRows.filter((r) => r.status !== "cancelled").map(displayedRow));
    console.log(
      `${year}: old page total ${oldTotals.grandTotal.toFixed(2)} €, new page total ${euros(ledger.totals.totalCents)} €` +
        ` (expected differences: corrected prices now reach the apartment columns, cancellation payouts count, direct bookings count for their apartment, pending requests do not)`,
    );
  }
  console.log(mismatches === 0 ? "Every corrected cell matches." : `${mismatches} corrected cells differ.`);
  if (mismatches > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

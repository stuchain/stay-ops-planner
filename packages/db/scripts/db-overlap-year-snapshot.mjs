/**
 * DB booking counts for UTC calendar-year overlap (matches GET /api/excel/listings?year= semantics
 * for the sum of listing cells: only rows with source_listing_id set).
 *
 * Usage (from repo root):
 *   node ./packages/db/scripts/db-overlap-year-snapshot.mjs 2026
 *
 * Loads `.env.hosthub.local` then `.env` at repo root (same idea as hosthub scripts).
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
config({ path: resolve(repoRoot, ".env.hosthub.local") });
config({ path: resolve(repoRoot, ".env") });

const year = Number(process.argv[2] ?? "2026");
if (!Number.isFinite(year) || year < 2000 || year > 2100) {
  console.error("Usage: node ./packages/db/scripts/db-overlap-year-snapshot.mjs [year]");
  process.exit(1);
}

const prisma = new PrismaClient();
const yearStart = new Date(Date.UTC(year, 0, 1));
const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
const w = {
  checkinDate: { lt: nextYearStart },
  checkoutDate: { gt: yearStart },
};

try {
  const [total, withL, withoutL, byChannel, byListing] = await Promise.all([
    prisma.booking.count({ where: w }),
    prisma.booking.count({ where: { ...w, sourceListingId: { not: null } } }),
    prisma.booking.count({ where: { ...w, sourceListingId: null } }),
    prisma.booking.groupBy({
      by: ["channel"],
      where: { ...w, sourceListingId: { not: null } },
      _count: { _all: true },
      orderBy: { channel: "asc" },
    }),
    prisma.booking.groupBy({
      by: ["sourceListingId"],
      where: { ...w, sourceListingId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const sumListingCells = byListing.reduce((s, r) => s + r._count._all, 0);
  console.log(
    JSON.stringify(
      {
        year,
        totalOverlap: total,
        withSourceListing: withL,
        withoutSourceListing: withoutL,
        byChannel,
        listingGroupRows: byListing.length,
        sumListingCells_matches_excel_listings_api: sumListingCells,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}

import { Prisma } from "@stay-ops/db";

/**
 * Prisma P2021 = table/view does not exist.
 * We use this to degrade gracefully when the excel ledger migration is not yet applied.
 */
export function isMissingExcelLedgerTableError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2021") return false;
  const table = (err.meta as { table?: unknown } | undefined)?.table;
  if (typeof table !== "string") return false;
  return table.toLowerCase().includes("excel_ledger_entries");
}

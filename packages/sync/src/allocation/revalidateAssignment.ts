import type { Prisma } from "@stay-ops/db";

/** Phase 4: re-check assignment validity after booking changes. */
export async function revalidateAssignmentIfNeeded(
  _tx: Prisma.TransactionClient,
  _bookingId: string,
): Promise<void> {
  void _tx;
  void _bookingId;
}

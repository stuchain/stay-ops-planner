import { Prisma } from "@prisma/client";

/**
 * Thrown when a proposed stay interval overlaps an existing assignment or manual block
 * for the same room. DB exclusion constraints catch same-table overlaps; this helper
 * additionally validates cross-table (assignment vs block) overlaps before insert.
 */
export class OverlapConflictError extends Error {
  readonly code = "OVERLAP_STAY" as const;

  constructor(message = "Stay interval overlaps an existing assignment or maintenance block") {
    super(message);
    this.name = "OverlapConflictError";
  }
}

export type AssertNoOverlapParams = {
  roomId: string;
  /** Inclusive first night (DATE). */
  start: Date;
  /** Exclusive end (checkout day, DATE) — half-open interval [start, end). */
  end: Date;
  /** When updating an assignment, exclude its row from the probe. */
  excludeAssignmentId?: string | null;
};

/**
 * Conflict probe for half-open stay ranges `[start, end)` in local DATE semantics.
 * Uses Postgres `daterange` with `'[)'` to match Appendix A in the phase spec.
 */
export async function assertNoOverlap(
  tx: Prisma.TransactionClient,
  params: AssertNoOverlapParams,
): Promise<void> {
  const { roomId, start, end, excludeAssignmentId } = params;

  const conflicts = await tx.$queryRaw<{ id: string; kind: string }[]>`
    SELECT id, 'assignment'::text AS kind
    FROM assignments
    WHERE room_id = ${roomId}
      AND daterange(start_date, end_date, '[)') && daterange(${start}::date, ${end}::date, '[)')
      AND (${excludeAssignmentId}::text IS NULL OR id <> ${excludeAssignmentId})
    UNION ALL
    SELECT id, 'block'::text AS kind
    FROM manual_blocks
    WHERE room_id = ${roomId}
      AND daterange(start_date, end_date, '[)') && daterange(${start}::date, ${end}::date, '[)')
    LIMIT 1
  `;

  if (conflicts.length > 0) {
    throw new OverlapConflictError();
  }
}

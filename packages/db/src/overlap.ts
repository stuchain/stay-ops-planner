import { Prisma } from "@prisma/client";

export type StayConflictKind = "assignment" | "block";

/** First overlapping row for a proposed half-open stay `[start, end)` on a room. */
export type StayConflict = {
  kind: StayConflictKind;
  id: string;
  roomId: string;
  startDate: Date;
  endDate: Date;
};

/**
 * Thrown when a proposed stay interval overlaps an existing assignment or manual block
 * for the same room. DB exclusion constraints catch same-table overlaps; this helper
 * additionally validates cross-table (assignment vs block) overlaps before insert.
 */
export class OverlapConflictError extends Error {
  readonly code = "OVERLAP_STAY" as const;

  constructor(
    message = "Stay interval overlaps an existing assignment or maintenance block",
    public readonly conflict?: StayConflict,
  ) {
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
  /** When updating a manual block, exclude its row from the probe. */
  excludeBlockId?: string | null;
};

/**
 * Conflict probe for half-open stay ranges `[start, end)` in local DATE semantics.
 * Uses Postgres `daterange` with `'[)'` to match Appendix A in the phase spec.
 */
export async function findStayConflict(
  tx: Prisma.TransactionClient,
  params: AssertNoOverlapParams,
): Promise<StayConflict | null> {
  const { roomId, start, end, excludeAssignmentId, excludeBlockId } = params;

  const rows = await tx.$queryRaw<
    {
      id: string;
      kind: string;
      room_id: string;
      start_date: Date;
      end_date: Date;
    }[]
  >`
    SELECT id, 'assignment'::text AS kind, room_id, start_date, end_date
    FROM assignments
    WHERE room_id = ${roomId}
      AND daterange(start_date, end_date, '[)') && daterange(${start}::date, ${end}::date, '[)')
      AND (${excludeAssignmentId}::text IS NULL OR id <> ${excludeAssignmentId})
    UNION ALL
    SELECT id, 'block'::text AS kind, room_id, start_date, end_date
    FROM manual_blocks
    WHERE room_id = ${roomId}
      AND daterange(start_date, end_date, '[)') && daterange(${start}::date, ${end}::date, '[)')
      AND (${excludeBlockId}::text IS NULL OR id <> ${excludeBlockId})
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  const kind: StayConflictKind = row.kind === "assignment" ? "assignment" : "block";
  return {
    kind,
    id: row.id,
    roomId: row.room_id,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

export async function assertNoOverlap(
  tx: Prisma.TransactionClient,
  params: AssertNoOverlapParams,
): Promise<void> {
  const conflict = await findStayConflict(tx, params);
  if (conflict) {
    throw new OverlapConflictError(undefined, conflict);
  }
}

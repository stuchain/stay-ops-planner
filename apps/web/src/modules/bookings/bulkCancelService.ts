import { writeAuditSnapshot } from "@stay-ops/audit";
import { BookingStatus, Prisma } from "@stay-ops/db";
import { applyCancellationSideEffects } from "@stay-ops/sync";
import { DryRunRollback, isDryRunRollback, PlanRecorder, type DryRunResult } from "@stay-ops/shared";
import { prisma } from "@/lib/prisma";

const BULK_MAX = 200;

export class BulkCancelBookingsError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(opts: { code: string; status: number; message: string; details?: unknown }) {
    super(opts.message);
    this.name = "BulkCancelBookingsError";
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details ?? {};
  }
}

export type BulkCancelBookingsInput = {
  bookingIds: string[];
  actorUserId: string;
  auditMeta?: Record<string, unknown>;
  dryRun?: boolean;
};

export type BulkCancelBookingsResult =
  | { dryRun: true; summary: DryRunResult }
  | { dryRun: false; cancelledIds: string[] };

/**
 * All-or-nothing bulk cancel: sets booking to `cancelled` and runs Hosthub-aligned cancellation side effects.
 */
export async function bulkCancelBookings(input: BulkCancelBookingsInput): Promise<BulkCancelBookingsResult> {
  const { bookingIds, actorUserId, auditMeta, dryRun } = input;
  if (bookingIds.length === 0) {
    throw new BulkCancelBookingsError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "At least one booking id is required",
    });
  }
  if (bookingIds.length > BULK_MAX) {
    throw new BulkCancelBookingsError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: `At most ${BULK_MAX} bookings per request`,
      details: { count: bookingIds.length },
    });
  }

  const recorder = dryRun ? new PlanRecorder() : undefined;

  try {
    const cancelledIds = await prisma.$transaction(
      async (tx) => {
        const ids: string[] = [];
        for (let i = 0; i < bookingIds.length; i += 1) {
          const id = bookingIds[i]!;
          const b = await tx.booking.findUnique({ where: { id } });
          if (!b) {
            throw new BulkCancelBookingsError({
              code: "BOOKING_NOT_FOUND",
              status: 422,
              message: "Booking not found",
              details: { failedIndex: i, bookingId: id },
            });
          }
          if (b.status === BookingStatus.cancelled) {
            continue;
          }

          const beforeStatus = b.status;
          await tx.booking.update({
            where: { id },
            data: { status: BookingStatus.cancelled },
          });

          recorder?.push({
            entityType: "booking",
            entityId: id,
            action: "update",
            before: { status: beforeStatus },
            after: { status: BookingStatus.cancelled },
          });

          await applyCancellationSideEffects(tx, id, actorUserId, {
            skipAudit: Boolean(dryRun),
            recorder: dryRun ? recorder : undefined,
          });

          if (!dryRun) {
            await writeAuditSnapshot(tx, {
              actorUserId,
              action: "booking.cancelled_bulk",
              entityType: "booking",
              entityId: id,
              before: { status: beforeStatus },
              after: { status: BookingStatus.cancelled },
              meta: { bookingId: id, ...(auditMeta ?? {}) },
            });
          }

          ids.push(id);
        }
        if (dryRun && recorder) {
          throw new DryRunRollback(recorder.snapshot());
        }
        return ids;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { dryRun: false, cancelledIds };
  } catch (e) {
    if (isDryRunRollback(e)) {
      return { dryRun: true, summary: e.plan };
    }
    throw e;
  }
}

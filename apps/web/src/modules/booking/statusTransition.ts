import type { BookingStatus } from "@stay-ops/db";

const ALLOWED: Record<BookingStatus, ReadonlySet<BookingStatus>> = {
  pending: new Set<BookingStatus>(["confirmed", "cancelled"]),
  confirmed: new Set<BookingStatus>(["cancelled", "needs_reassignment"]),
  needs_reassignment: new Set<BookingStatus>(["confirmed", "cancelled"]),
  cancelled: new Set<BookingStatus>(),
};

/** Legal next statuses (excluding staying put) for a booking in `from`. */
export function allowedNextStatuses(from: BookingStatus): BookingStatus[] {
  return [...ALLOWED[from]];
}

export class InvalidBookingStatusTransitionError extends Error {
  readonly name = "InvalidBookingStatusTransitionError";

  constructor(
    public readonly from: BookingStatus,
    public readonly to: BookingStatus,
  ) {
    super(`Illegal booking status transition: ${from} -> ${to}`);
  }
}

export function assertBookingStatusTransition(from: BookingStatus, to: BookingStatus): void {
  if (from === to) {
    return;
  }
  const allowed = ALLOWED[from];
  if (!allowed?.has(to)) {
    throw new InvalidBookingStatusTransitionError(from, to);
  }
}

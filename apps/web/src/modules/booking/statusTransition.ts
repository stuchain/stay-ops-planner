import { BookingStatus } from "@stay-ops/db";

const ALLOWED: Record<BookingStatus, ReadonlySet<BookingStatus>> = {
  pending: new Set([BookingStatus.confirmed, BookingStatus.cancelled]),
  confirmed: new Set([BookingStatus.cancelled, BookingStatus.needs_reassignment]),
  needs_reassignment: new Set([BookingStatus.confirmed, BookingStatus.cancelled]),
  cancelled: new Set(),
};

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

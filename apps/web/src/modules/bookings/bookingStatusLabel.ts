import type { BookingStatus } from "@stay-ops/db";
import { allowedNextStatuses } from "@/modules/booking/statusTransition";

const BOOKING_STATUS_LABELS: Record<string, string> = {
  confirmed: "Επιβεβαιωμένη",
  pending: "Αναμένει επιβεβαίωση",
  cancelled: "Ακυρωμένη",
  needs_reassignment: "Χρειάζεται νέο διαμέρισμα",
};

/** Plain Greek wording for a booking status. Unknown values are returned unchanged. */
export function bookingStatusLabel(status: string): string {
  return Object.prototype.hasOwnProperty.call(BOOKING_STATUS_LABELS, status)
    ? BOOKING_STATUS_LABELS[status]!
    : status;
}

/** Pending bookings are shown greyed and cannot be assigned until confirmed. */
export function isPendingBooking(status: string | null | undefined): boolean {
  return status === "pending";
}

/**
 * Statuses the status dropdown may offer: the current one plus the legal next ones.
 * "needs_reassignment" is only ever set by the system, never offered as a manual choice
 * (it still appears when it is the current status).
 */
export function statusChoicesFor(current: BookingStatus): BookingStatus[] {
  const next = allowedNextStatuses(current).filter((s) => s !== "needs_reassignment");
  return [current, ...next];
}

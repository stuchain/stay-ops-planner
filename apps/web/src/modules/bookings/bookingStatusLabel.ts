const BOOKING_STATUS_LABELS: Record<string, string> = {
  confirmed: "Επιβεβαιωμένη",
  pending: "Αναμένει επιβεβαίωση",
  cancelled: "Ακυρωμένη",
  needs_reassignment: "Χρειάζεται νέο διαμέρισμα",
  completed: "Ολοκληρωμένη",
  no_show: "Δεν εμφανίστηκε",
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

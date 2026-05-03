/**
 * Prisma `where` fragment for bookings that occupy at least one night in the given UTC calendar year.
 * Matches sync night model (`parseDateOnlyUtc` / `nightsBetweenCheckinCheckout`): check-in inclusive, check-out exclusive.
 */
export function bookingOverlapsUtcCalendarYearWhere(year: number): {
  checkinDate: { lt: Date };
  checkoutDate: { gt: Date };
} {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
  return {
    checkinDate: { lt: nextYearStart },
    checkoutDate: { gt: yearStart },
  };
}

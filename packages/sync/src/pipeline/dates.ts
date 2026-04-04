const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** UTC calendar date for `@db.Date` columns (night-based model; checkout exclusive). */
export function parseDateOnlyUtc(isoDate: string): Date {
  const m = DATE_ONLY.exec(isoDate.trim());
  if (!m) {
    throw new Error(`Expected YYYY-MM-DD date, got: ${isoDate}`);
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo - 1, d));
}

export function nightsBetweenCheckinCheckout(checkin: Date, checkout: Date): number {
  const ms = checkout.getTime() - checkin.getTime();
  if (ms <= 0) {
    throw new Error("checkout must be after checkin");
  }
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

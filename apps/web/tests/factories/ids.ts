let counter = 0;

/** Unique-per-process token for codes, emails and external ids. */
export function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Date-only strings (`YYYY-MM-DD`) to the UTC midnight `Date` Prisma expects for `@db.Date` columns. */
export function dateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected YYYY-MM-DD, got "${value}"`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((dateOnly(checkOut).getTime() - dateOnly(checkIn).getTime()) / 86_400_000);
}

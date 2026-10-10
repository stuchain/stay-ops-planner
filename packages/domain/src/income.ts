import { cents, ZERO_CENTS, type Cents } from "./money.js";
import type { IncomeBasis } from "./tax.js";

export type MoneyChannel = "airbnb" | "booking" | "direct";
export type MoneyStatus = "pending" | "confirmed" | "cancelled" | "needs_reassignment";

/** The synced booking columns the money page reads (never the raw Hosthub JSON). */
export interface BookingMoney {
  readonly channel: MoneyChannel;
  readonly status: MoneyStatus;
  /** What the guest pays in total, cleaning included (Hosthub `total_value`). */
  readonly totalValueCents: number | null;
  /** Accommodation only (Hosthub `booking_value`); used when the total is missing. */
  readonly bookingValueCents: number | null;
  /** Net to the owner after platform fees (Hosthub `total_payout`). */
  readonly payoutCents: number | null;
  readonly cleaningFeeCents: number | null;
  readonly currency: string | null;
}

/**
 * - `confirmed`: a normal stay.
 * - `cancelled_paid`: cancelled, but the platform still paid something out.
 * - `cancelled_unpaid`: cancelled with nothing paid.
 * - `pending`: a request that is not confirmed yet; not income (E3-3).
 */
export type IncomeKind = "confirmed" | "cancelled_paid" | "cancelled_unpaid" | "pending";

export interface Income {
  readonly kind: IncomeKind;
  /** What the guest paid. For a cancellation, what was actually paid out. */
  readonly grossCents: Cents;
  /** What reached the owner. */
  readonly payoutCents: Cents;
  /** The platform's cut, when both figures are known. */
  readonly channelFeeCents: Cents | null;
  readonly cleaningFeeCents: Cents | null;
  /** Whether the row adds to the year's totals. */
  readonly counts: boolean;
  /** Not in euros: shown flagged and left for a person to check (E3-12). */
  readonly foreignCurrency: boolean;
}

function toCents(value: number | null): Cents | null {
  return value == null ? null : cents(value);
}

/**
 * Income rules:
 * - Airbnb and Booking.com: the payout when present, otherwise the total.
 * - Direct: the total (there is no platform cut).
 * - Cancelled: only what was actually paid out, 0 if nothing.
 * - Pending: shown, never counted.
 */
export function incomeFor(b: BookingMoney): Income {
  const total = toCents(b.totalValueCents) ?? toCents(b.bookingValueCents);
  const reportedPayout = toCents(b.payoutCents);
  const foreignCurrency = b.currency != null && b.currency.trim().toUpperCase() !== "EUR";
  const cleaningFeeCents = toCents(b.cleaningFeeCents);

  if (b.status === "cancelled") {
    const paid = reportedPayout ?? ZERO_CENTS;
    return {
      kind: paid > 0 ? "cancelled_paid" : "cancelled_unpaid",
      grossCents: paid,
      payoutCents: paid,
      channelFeeCents: null,
      cleaningFeeCents: null,
      counts: paid !== 0,
      foreignCurrency,
    };
  }

  const gross = total ?? reportedPayout ?? ZERO_CENTS;
  const payout = b.channel === "direct" ? gross : (reportedPayout ?? gross);
  return {
    kind: b.status === "pending" ? "pending" : "confirmed",
    grossCents: gross,
    payoutCents: payout,
    channelFeeCents:
      b.channel !== "direct" && total != null && reportedPayout != null ? cents(total - reportedPayout) : null,
    cleaningFeeCents,
    counts: b.status !== "pending",
    foreignCurrency,
  };
}

/** The amount the tax is worked out on, per the year's rules. */
export function taxableCents(income: Income, basis: IncomeBasis): Cents {
  return basis === "gross" ? income.grossCents : income.payoutCents;
}

/** Apartments 1–4 in the ledger's column order: Onar, Cosmos, Iris, Helios. */
export type RentalIndex = 1 | 2 | 3 | 4;

export const RENTAL_INDEXES: readonly RentalIndex[] = [1, 2, 3, 4];

export function isRentalIndex(value: unknown): value is RentalIndex {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export interface RentalBucketInput {
  readonly channel: MoneyChannel;
  /** The listing the guest booked (`SourceListing.rentalIndex`, editable in Dev mode). */
  readonly listingRentalIndex: number | null;
  /** The apartment the guest stayed in (from the calendar). */
  readonly stayedRentalIndex: number | null;
  /** A correction typed on the ledger. */
  readonly overrideRentalIndex?: number | null;
}

export type RentalBucketSource = "override" | "listing" | "stayed" | "none";

export interface RentalBucket {
  readonly index: RentalIndex | null;
  readonly source: RentalBucketSource;
  /** Shown next to the bucket so a difference is visible. */
  readonly stayedIndex: RentalIndex | null;
}

/**
 * Which apartment the income counts for (decision 3): the listing the guest
 * booked, with the apartment they stayed in shown next to it. Direct bookings
 * have no listing, so they count for the apartment they stayed in. A correction
 * on the ledger wins over both.
 */
export function rentalBucketFor(input: RentalBucketInput): RentalBucket {
  const stayedIndex = isRentalIndex(input.stayedRentalIndex) ? input.stayedRentalIndex : null;
  if (isRentalIndex(input.overrideRentalIndex)) {
    return { index: input.overrideRentalIndex, source: "override", stayedIndex };
  }
  if (input.channel !== "direct" && isRentalIndex(input.listingRentalIndex)) {
    return { index: input.listingRentalIndex, source: "listing", stayedIndex };
  }
  if (input.channel === "direct" && stayedIndex !== null) {
    return { index: stayedIndex, source: "stayed", stayedIndex };
  }
  return { index: null, source: "none", stayedIndex };
}

import { z } from "zod";
import type { Channel } from "@stay-ops/db";
import { readCentsFromField } from "@/modules/bookings/details";

const RENTAL_TITLE_KEYS: readonly { key: string; index: number }[] = [
  { key: "onar", index: 1 },
  { key: "cosmos", index: 2 },
  { key: "iris", index: 3 },
  { key: "helios", index: 4 },
] as const;

export function guessRentalIndexFromTitle(title: string | null | undefined): number | null {
  const hay = (title ?? "").toLowerCase();
  if (!hay) return null;
  for (const { key, index } of RENTAL_TITLE_KEYS) {
    if (hay.includes(key)) return index;
  }
  return null;
}

type Dict = Record<string, unknown>;

function asObject(value: unknown): Dict {
  return value && typeof value === "object" ? (value as Dict) : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export type LedgerRow = {
  name: string;
  guestCount: number | null;
  passport: string;
  roomLocation: string;
  dateRange: string;
  nights: number | null;
  airbnbAmount: number | null;
  bookingAmount: number | null;
  contractAmount: number | null;
  soloAmount: number | null;
  prepayment: number | null;
  payoutAmount: number | null;
  rentalIndex: number | null;
  rental1: number | null;
  rental2: number | null;
  rental3: number | null;
  rental4: number | null;
};

/** Legacy combined column stored in older overrides JSON. */
export const OverridesSchema = z
  .object({
    nameAndGuests: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    guestCount: z.number().int().min(0).nullable().optional(),
    passport: z.string().nullable().optional(),
    roomLocation: z.string().nullable().optional(),
    dateRange: z.string().nullable().optional(),
    nights: z.number().finite().nonnegative().nullable().optional(),
    airbnbAmount: z.number().finite().nonnegative().nullable().optional(),
    bookingAmount: z.number().finite().nonnegative().nullable().optional(),
    contractAmount: z.number().finite().nonnegative().nullable().optional(),
    soloAmount: z.number().finite().nonnegative().nullable().optional(),
    prepayment: z.number().finite().nonnegative().nullable().optional(),
    payoutAmount: z.number().finite().nonnegative().nullable().optional(),
    rentalIndex: z.number().int().min(1).max(4).nullable().optional(),
    rental1: z.number().finite().nonnegative().nullable().optional(),
    rental2: z.number().finite().nonnegative().nullable().optional(),
    rental3: z.number().finite().nonnegative().nullable().optional(),
    rental4: z.number().finite().nonnegative().nullable().optional(),
  })
  .strict();

export type Overrides = z.infer<typeof OverridesSchema>;

export type BookingForLedger = {
  channel: Channel;
  checkinDate: Date;
  checkoutDate: Date;
  nights: number;
  guestName: string | null;
  guestEmail: string | null;
  guestAdults: number | null;
  guestChildren: number | null;
  guestInfants: number | null;
  guestTotal: number | null;
  rawPayload: unknown;
  sourceListingTitle: string | null;
  /** Planner assignment room display name → ROOM LOCATION auto value only. */
  roomDisplayName: string | null;
  /** Persisted Hosthub listing binding 1–4 (Onar/Cosmos/Iris/Helios); drives ROOM AMA + rental columns. */
  sourceListingRentalIndex: number | null;
};

function guestCountFromBooking(b: BookingForLedger): number | null {
  if (b.guestTotal != null && b.guestTotal > 0) return b.guestTotal;
  const a = b.guestAdults ?? 0;
  const c = b.guestChildren ?? 0;
  const i = b.guestInfants ?? 0;
  const sum = a + c + i;
  return sum > 0 ? sum : null;
}

/** Last whitespace-separated integer → guest count; rest → name (legacy `NAME 2`). */
export function splitLegacyNameGuests(combined: string): { name: string; guestCount: number | null } {
  const t = combined.trim();
  if (!t) return { name: "", guestCount: null };
  const match = t.match(/^(.+?)\s+(\d+)$/);
  if (match) {
    const name = match[1]!.trim().toUpperCase();
    const n = Number(match[2]);
    return { name, guestCount: Number.isFinite(n) ? n : null };
  }
  return { name: t.toUpperCase(), guestCount: null };
}

/** Heuristic: doc-like if mostly digits/alnum and length >= 6, not a typical email domain-only. */
export function formatPassportFallback(rawPayload: unknown, guestEmail: string | null): string {
  const raw = asObject(rawPayload);
  const guest = asObject(raw.guest);
  const id =
    asString(raw.guest_identification_number) ??
    asString(guest.identification_number) ??
    asString(guest.passport) ??
    asString(guest.document_number);
  if (id) return id;
  const email = guestEmail?.trim() ?? "";
  if (email.length >= 6 && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) {
    const local = email.split("@")[0] ?? "";
    if (/^\d{6,}$/.test(local)) return email;
    return "";
  }
  return "";
}

export function formatStayRange(from: Date, to: Date): string {
  const d1 = from.getUTCDate();
  const m1 = from.getUTCMonth() + 1;
  const y1 = from.getUTCFullYear();
  const d2 = to.getUTCDate();
  const m2 = to.getUTCMonth() + 1;
  const y2 = to.getUTCFullYear();
  if (y1 === y2 && m1 === m2) return `${d1}-${d2}/${m1}/`;
  if (y1 === y2) return `${d1}/${m1}-${d2}/${m2}`;
  const yy1 = String(y1).slice(2);
  const yy2 = String(y2).slice(2);
  return `${d1}/${m1}/${yy1}-${d2}/${m2}/${yy2}`;
}

function resolveRentalIndex(b: BookingForLedger): number | null {
  // Direct bookings are never auto-mapped from Hosthub listing; user assigns tax room in Excel.
  if (b.channel === "direct") return null;
  const r = b.sourceListingRentalIndex;
  if (r != null && r >= 1 && r <= 4) return r;
  return null;
}

export function buildAutoRow(b: BookingForLedger): LedgerRow {
  const raw = asObject(b.rawPayload);
  const totalValue = readCentsFromField(raw, "total_value");
  const totalPayout = readCentsFromField(raw, "total_payout");

  let airbnbAmount: number | null = null;
  let bookingAmount: number | null = null;
  let soloAmount: number | null = null;
  if (b.channel === "airbnb") airbnbAmount = totalValue;
  else if (b.channel === "booking") bookingAmount = totalValue;
  else soloAmount = totalValue;

  const channelAmount = airbnbAmount ?? bookingAmount ?? soloAmount;

  let payoutAmount: number | null = null;
  if (b.channel === "airbnb" || b.channel === "booking") payoutAmount = totalPayout ?? totalValue;
  else payoutAmount = soloAmount;

  const rentalIndex = resolveRentalIndex(b);
  const rental1 = rentalIndex === 1 ? channelAmount : null;
  const rental2 = rentalIndex === 2 ? channelAmount : null;
  const rental3 = rentalIndex === 3 ? channelAmount : null;
  const rental4 = rentalIndex === 4 ? channelAmount : null;

  const name = (b.guestName ?? "").trim().toUpperCase();
  const guestCount = guestCountFromBooking(b);

  return {
    name,
    guestCount,
    passport: formatPassportFallback(b.rawPayload, b.guestEmail),
    roomLocation: (b.roomDisplayName ?? "").trim(),
    dateRange: formatStayRange(b.checkinDate, b.checkoutDate),
    nights: Number.isFinite(b.nights) ? b.nights : null,
    airbnbAmount,
    bookingAmount,
    contractAmount: null,
    soloAmount,
    prepayment: null,
    payoutAmount,
    rentalIndex,
    rental1,
    rental2,
    rental3,
    rental4,
  };
}

type LedgerKey = keyof LedgerRow;

function pickOverride<K extends LedgerKey>(
  o: Overrides,
  key: K,
  autoVal: LedgerRow[K],
): LedgerRow[K] {
  const v = o[key as keyof Overrides];
  if (v === undefined) return autoVal;
  if (v === null) return autoVal;
  return v as LedgerRow[K];
}

export function applyOverrides(auto: LedgerRow, overrides: Overrides | null | undefined): LedgerRow {
  if (!overrides) return { ...auto };
  const o = overrides;
  const raw = o as Record<string, unknown>;

  let name = auto.name;
  let guestCount = auto.guestCount;
  const legacy = raw.nameAndGuests;
  const hasNameKey = Object.prototype.hasOwnProperty.call(o, "name");
  const hasGuestCountKey = Object.prototype.hasOwnProperty.call(o, "guestCount");
  if (typeof legacy === "string" && !hasNameKey && !hasGuestCountKey) {
    const leg = splitLegacyNameGuests(legacy);
    name = leg.name;
    guestCount = leg.guestCount;
  }

  name = pickOverride(o, "name", name);
  guestCount = pickOverride(o, "guestCount", guestCount);

  const pick = <K extends LedgerKey>(key: K): LedgerRow[K] => pickOverride(o, key, auto[key]);

  return {
    name,
    guestCount,
    passport: pick("passport"),
    roomLocation: pick("roomLocation"),
    dateRange: pick("dateRange"),
    nights: pick("nights"),
    airbnbAmount: pick("airbnbAmount"),
    bookingAmount: pick("bookingAmount"),
    contractAmount: pick("contractAmount"),
    soloAmount: pick("soloAmount"),
    prepayment: pick("prepayment"),
    payoutAmount: pick("payoutAmount"),
    rentalIndex: pick("rentalIndex"),
    rental1: pick("rental1"),
    rental2: pick("rental2"),
    rental3: pick("rental3"),
    rental4: pick("rental4"),
  };
}

/** True if overrides JSON still carries this key (user-set; cleared keys are removed). */
export function hasExplicitOverride(
  overrides: Overrides | null | undefined,
  key: keyof Overrides,
): boolean {
  if (!overrides) return false;
  return Object.prototype.hasOwnProperty.call(overrides, key);
}

/** True if the displayed value for this field differs from auto (including legacy nameAndGuests). */
export function hasMeaningfulOverride(
  auto: LedgerRow,
  overrides: Overrides | null | undefined,
  key: keyof LedgerRow,
): boolean {
  const displayed = applyOverrides(auto, overrides)[key];
  const autoVal = auto[key];
  if (typeof displayed === "number" && typeof autoVal === "number") {
    return !Number.isFinite(displayed) || !Number.isFinite(autoVal)
      ? displayed !== autoVal
      : Math.abs(displayed - autoVal) >= 1e-9;
  }
  return displayed !== autoVal;
}

/** Display value with override semantics: null in overrides object removes override → auto. */
export function mergeOverridePatch(
  existing: Overrides | null | undefined,
  patch: Partial<Record<keyof Overrides, unknown>>,
): Overrides {
  const base = { ...(existing ?? {}) } as Overrides;
  for (const [k, v] of Object.entries(patch) as [keyof Overrides, unknown][]) {
    if (v === null) {
      delete base[k];
      continue;
    }
    if (v === undefined) continue;
    (base as Record<string, unknown>)[k as string] = v;
  }
  return base;
}

export type LedgerTotals = {
  sumByRental: [number, number, number, number];
  grandTotal: number;
  sumJ: number;
  sumL: number;
  topBracketTax: number;
  perRentalBracketTax: [number, number, number, number];
};

function num(n: number | null | undefined): number {
  if (n === null || n === undefined || !Number.isFinite(n)) return 0;
  return n;
}

export function computeTotals(rows: LedgerRow[]): LedgerTotals {
  const sumByRental: [number, number, number, number] = [0, 0, 0, 0];
  let sumJ = 0;
  let sumL = 0;
  for (const r of rows) {
    sumByRental[0] += num(r.rental1);
    sumByRental[1] += num(r.rental2);
    sumByRental[2] += num(r.rental3);
    sumByRental[3] += num(r.rental4);
    sumJ += num(r.soloAmount);
    sumL += num(r.payoutAmount);
  }
  const grandTotal = sumByRental[0] + sumByRental[1] + sumByRental[2] + sumByRental[3];
  const topBracketTax = 9850 + (grandTotal - 35000) * 0.45;
  const perRentalBracketTax: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) {
    const col = sumByRental[i]!;
    perRentalBracketTax[i] = 1800 + (col - 12000) * 0.35;
  }
  return {
    sumByRental,
    grandTotal,
    sumJ,
    sumL,
    topBracketTax,
    perRentalBracketTax,
  };
}

export function emptyManualAutoRow(): LedgerRow {
  return {
    name: "",
    guestCount: null,
    passport: "",
    roomLocation: "",
    dateRange: "",
    nights: null,
    airbnbAmount: null,
    bookingAmount: null,
    contractAmount: null,
    soloAmount: null,
    prepayment: null,
    payoutAmount: null,
    rentalIndex: null,
    rental1: null,
    rental2: null,
    rental3: null,
    rental4: null,
  };
}

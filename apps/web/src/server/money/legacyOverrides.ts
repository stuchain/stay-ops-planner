import { eurosToCents, isRentalIndex, type LedgerOverrides } from "@stay-ops/domain";

/** Old euro-float keys in `excel_ledger_entries.overrides` → new cent keys in `ledger_entries.overrides`. */
const MONEY_KEYS: Record<string, keyof LedgerOverrides> = {
  airbnbAmount: "airbnbCents",
  bookingAmount: "bookingCents",
  contractAmount: "contractCents",
  soloAmount: "soloCents",
  prepayment: "prepaymentCents",
  payoutAmount: "payoutCents",
  rental1: "rental1Cents",
  rental2: "rental2Cents",
  rental3: "rental3Cents",
  rental4: "rental4Cents",
};
const TEXT_KEYS = ["name", "passport", "roomLocation", "dateRange"] as const;
const COUNT_KEYS = ["guestCount", "nights"] as const;

/** Legacy "NAME 2" combined column → name and guest count. */
function splitNameAndGuests(combined: string): { name: string; guestCount: number | null } {
  const t = combined.trim();
  const match = /^(.+?)\s+(\d+)$/.exec(t);
  if (match) return { name: match[1]!.trim().toUpperCase(), guestCount: Number(match[2]) };
  return { name: t.toUpperCase(), guestCount: null };
}

export type LegacyConversion = { overrides: LedgerOverrides; dropped: string[] };

/**
 * Converts one old overrides object. In the old format a present key was always a
 * correction (clearing deleted the key), so every present, valid key carries over.
 * Anything that can't be read is listed in `dropped` for the migration report.
 */
export function convertLegacyOverrides(value: unknown): LegacyConversion {
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { overrides: {}, dropped };
  const src = value as Record<string, unknown>;
  for (const [key, v] of Object.entries(src)) {
    if (v === null || v === undefined) continue;
    if (key in MONEY_KEYS) {
      if (typeof v === "number" && Number.isFinite(v)) out[MONEY_KEYS[key]!] = eurosToCents(v);
      else dropped.push(key);
    } else if ((TEXT_KEYS as readonly string[]).includes(key)) {
      if (typeof v === "string") out[key] = v;
      else dropped.push(key);
    } else if ((COUNT_KEYS as readonly string[]).includes(key)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = Math.round(v);
      else dropped.push(key);
    } else if (key === "rentalIndex") {
      if (isRentalIndex(v)) out.rentalIndex = v;
      else dropped.push(key);
    } else if (key === "nameAndGuests") {
      if (typeof v !== "string") {
        dropped.push(key);
        continue;
      }
      const split = splitNameAndGuests(v);
      if (!("name" in src)) out.name = split.name;
      if (!("guestCount" in src)) out.guestCount = split.guestCount;
    } else {
      dropped.push(key);
    }
  }
  return { overrides: out as LedgerOverrides, dropped };
}

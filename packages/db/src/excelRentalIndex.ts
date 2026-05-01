/** Substring match order: Onar=1, Cosmos=2, Iris=3, Helios=4 (same as legacy Excel ledger). */
const RENTAL_TITLE_KEYS: readonly { key: string; index: number }[] = [
  { key: "onar", index: 1 },
  { key: "cosmos", index: 2 },
  { key: "iris", index: 3 },
  { key: "helios", index: 4 },
] as const;

/**
 * Guess rental slot (1–4) from a Hosthub listing title / name.
 * Returns null if no known rental keyword appears.
 */
export function guessRentalIndexFromTitle(title: string | null | undefined): number | null {
  const hay = (title ?? "").toLowerCase();
  if (!hay) return null;
  for (const { key, index } of RENTAL_TITLE_KEYS) {
    if (hay.includes(key)) return index;
  }
  return null;
}

/** Best-effort extraction of per-day rates from Hosthub calendar JSON. */

export type DailyRateCell = {
  amountCents: number;
  currency: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function readCents(o: Record<string, unknown>): number | undefined {
  const cents = o.cents;
  if (typeof cents === "number" && Number.isFinite(cents)) return Math.round(cents);
  const amount = o.amount ?? o.value;
  if (typeof amount === "number" && Number.isFinite(amount)) return Math.round(amount * 100);
  if (typeof amount === "string" && amount.trim()) {
    const n = Number(amount.trim());
    if (Number.isFinite(n)) return Math.round(n * 100);
  }
  return undefined;
}

function mergeRate(
  out: Map<string, DailyRateCell>,
  dateStr: string,
  cents: number,
  currency: string,
): void {
  const d = dateStr.slice(0, 10);
  if (!DATE_RE.test(d)) return;
  if (out.has(d)) return;
  out.set(d, { amountCents: cents, currency: currency || "EUR" });
}

/**
 * Walk nested JSON for objects that look like `{ date: "YYYY-MM-DD", cents/amount, currency }`.
 */
export function extractDailyRatesFromHosthubJson(raw: unknown): Map<string, DailyRateCell> {
  const out = new Map<string, DailyRateCell>();
  const seen = new WeakSet<object>();

  function walk(node: unknown, currencyHint: string): void {
    if (node === null || node === undefined) return;
    if (typeof node === "object") {
      if (seen.has(node as object)) return;
      seen.add(node as object);
    }
    if (Array.isArray(node)) {
      for (const el of node) walk(el, currencyHint);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const cur =
      typeof o.currency === "string" && o.currency.trim()
        ? o.currency.trim()
        : typeof o.currency_code === "string"
          ? o.currency_code.trim()
          : currencyHint;

    const dateRaw = o.date ?? o.day ?? o.stay_date ?? o.night;
    if (typeof dateRaw === "string" && DATE_RE.test(dateRaw)) {
      const cents = readCents(o);
      if (cents !== undefined) mergeRate(out, dateRaw, cents, cur);
    }

    for (const k of Object.keys(o)) {
      walk(o[k], cur);
    }
  }

  walk(raw, "EUR");
  return out;
}

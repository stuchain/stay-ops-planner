export const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
};

export function fmtHosthubMoney(value: number | null, currency: string | null): string {
  if (value === null) return "-";
  const code = currency?.trim().toUpperCase() ?? "";
  const sym = code ? (CURRENCY_SYMBOL[code] ?? null) : null;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const formatted = abs.toFixed(2);
  if (sym) return `${sign}${formatted} ${sym}`;
  if (code && /^[A-Z]{3}$/.test(code)) return `${sign}${formatted} ${code}`;
  return `${sign}${formatted}`;
}

export function fmtDeduction(value: number | null, currency: string | null): string {
  if (value === null) return "-";
  if (value === 0) return fmtHosthubMoney(0, currency);
  return fmtHosthubMoney(-Math.abs(value), currency);
}

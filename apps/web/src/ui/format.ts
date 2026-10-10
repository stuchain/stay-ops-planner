import type { IsoDate } from "@stay-ops/domain";

export type UiLocale = "el" | "en";

const INTL_LOCALE: Record<UiLocale, string> = { el: "el-GR", en: "en-GB" };

/** Canonical short months, so the output never depends on the ICU build ("Μαΐ", not "Μάι"). */
const EL_MONTHS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];

const NBSP = " ";

const formatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: UiLocale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...options, timeZone: "UTC" });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** Parses "YYYY-MM-DD" as UTC midnight, so the calendar day never shifts. */
function parse(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function stripDots(text: string): string {
  return text.replace(/\./g, "").trim();
}

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
}

function weekday(date: Date, locale: UiLocale): string {
  const text = stripDots(dateFormatter(locale, { weekday: "short" }).format(date));
  // Greek: Intl gives "Τρί", "Πέμ", "Σάβ"; the design uses "Τρι", "Πεμ", "Σαβ".
  return locale === "el" ? stripAccents(text) : text.slice(0, 3);
}

function month(date: Date, locale: UiLocale): string {
  if (locale === "el") return EL_MONTHS[date.getUTCMonth()] ?? "";
  return stripDots(dateFormatter(locale, { month: "short" }).format(date)).slice(0, 3);
}

/** "Παρ 17 Οκτ" (el) or "Fri 17 Oct" (en); with `withYear`, "Παρ 17 Οκτ 2026". */
export function formatDay(iso: IsoDate, locale: UiLocale = "el", withYear = false): string {
  const date = parse(iso);
  const base = `${weekday(date, locale)} ${date.getUTCDate()} ${month(date, locale)}`;
  return withYear ? `${base} ${date.getUTCFullYear()}` : base;
}

/**
 * "Παρ 17 – Τρι 21 Οκτ"; the month is repeated on the left only when it differs
 * ("Παρ 31 Οκτ – Τρι 4 Νοε"). The year is added at the end with `withYear`,
 * and on both sides when the years differ.
 */
export function formatRange(from: IsoDate, to: IsoDate, locale: UiLocale = "el", withYear = false): string {
  const a = parse(from);
  const b = parse(to);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  const left = sameMonth ? `${weekday(a, locale)} ${a.getUTCDate()}` : formatDay(from, locale, withYear && !sameYear);
  const right = formatDay(to, locale, withYear);
  return `${left} – ${right}`;
}

/** Number of nights between two dates (check-out minus check-in). */
export function nightsBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

/** Integer cents to "1.250 €" / "12,50 €" (el) or "€1,250" / "€12.50" (en). */
export function formatMoney(cents: number, locale: UiLocale = "el"): string {
  const rounded = Math.round(cents);
  const abs = Math.abs(rounded);
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  const thousands = locale === "el" ? "." : ",";
  const decimal = locale === "el" ? "," : ".";
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  const amount = rest === 0 ? grouped : `${grouped}${decimal}${String(rest).padStart(2, "0")}`;
  const sign = rounded < 0 ? "−" : "";
  return locale === "el" ? `${sign}${amount}${NBSP}€` : `${sign}€${amount}`;
}

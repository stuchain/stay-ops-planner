/**
 * Money is stored and computed in whole cents. Euros appear only at the edges:
 * when a person types an amount, when the screen formats one, and in the Excel file.
 */
declare const centsBrand: unique symbol;

export type Cents = number & { readonly [centsBrand]: "Cents" };

export const ZERO_CENTS = 0 as Cents;

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Cents must be a whole number: ${value}`);
  return value as Cents;
}

export function sumCents(values: Iterable<Cents | null | undefined>): Cents {
  let total = 0;
  for (const v of values) if (v != null) total += v;
  return cents(total);
}

/**
 * Converts a euro amount held as a float (old overrides, Excel cells) to cents.
 * `toPrecision(15)` strips binary noise first, so 1.005 € becomes 101, not 100.
 */
export function eurosToCents(euros: number): Cents {
  if (!Number.isFinite(euros)) throw new RangeError(`Not an amount: ${euros}`);
  return cents(Math.round(Number((euros * 100).toPrecision(15))));
}

/** For the Excel file and charts only; never compute with the result. */
export function centsToEuros(value: Cents): number {
  return value / 100;
}

const EURO_FORMAT = new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" });

/** "1.234,56 €" (Greek format). */
export function formatEuros(value: Cents): string {
  return EURO_FORMAT.format(value / 100);
}

export type ParsedAmount = { ok: true; cents: Cents } | { ok: false };

/**
 * Reads an amount the way a person in Greece types it: "1.234,56", "1234,56",
 * "1234.56", "1.234", "-50", "€ 80". Anything unclear (letters, three decimals,
 * badly grouped thousands) is rejected rather than guessed, and an empty box is
 * rejected too: clearing a correction is a separate action.
 */
export function parseEuroInput(text: string): ParsedAmount {
  let s = text.replace(/[\s\u00a0\u20ac]/g, "").replace(/\u2212/g, "-");
  let sign = 1;
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return { ok: false };

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart: string;
  let fraction = "";
  let thousands: string | null = null;

  if (lastComma >= 0 && lastDot >= 0) {
    // Both used: whichever comes last is the decimal mark, the other groups thousands.
    const decimalAt = Math.max(lastComma, lastDot);
    thousands = decimalAt === lastComma ? "." : ",";
    intPart = s.slice(0, decimalAt);
    fraction = s.slice(decimalAt + 1);
  } else if (lastComma >= 0) {
    // Greek decimal comma: "1234,5" or "1234,56". "1,234" would be three decimals.
    intPart = s.slice(0, lastComma);
    fraction = s.slice(lastComma + 1);
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    // Greek thousands: "1.234" or "12.345.678".
    thousands = ".";
    intPart = s;
  } else if (lastDot >= 0) {
    intPart = s.slice(0, lastDot);
    fraction = s.slice(lastDot + 1);
  } else {
    intPart = s;
  }

  if (thousands !== null && intPart.includes(thousands)) {
    if (!/^\d{1,3}(\.\d{3})*$|^\d{1,3}(,\d{3})*$/.test(intPart)) return { ok: false };
    intPart = intPart.split(thousands).join("");
  }
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(fraction)) return { ok: false };

  const value = Number(intPart) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) return { ok: false };
  return { ok: true, cents: cents(value === 0 ? 0 : sign * value) };
}

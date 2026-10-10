/** Money is stored and computed in integer cents. Filled in Phase 3 (the money page). */
export type Cents = number & { readonly __brand: "Cents" };

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Cents must be a whole number: ${value}`);
  return value as Cents;
}

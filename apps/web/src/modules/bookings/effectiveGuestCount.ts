/**
 * Party size for capacity checks. Returns null when unknown — callers should not apply max-guest limits.
 */
export type GuestCountFields = {
  guestTotal: number | null | undefined;
  guestAdults?: number | null | undefined;
  guestChildren?: number | null | undefined;
  guestInfants?: number | null | undefined;
};

export function effectiveGuestCount(b: GuestCountFields): number | null {
  const gt = b.guestTotal;
  if (gt != null && gt > 0) return gt;
  const parts =
    (b.guestAdults ?? 0) + (b.guestChildren ?? 0) + (b.guestInfants ?? 0);
  if (parts > 0) return parts;
  return null;
}

/** When `guests` is null (unknown), any room is allowed by capacity. */
export function roomAcceptsParty(maxGuests: number | null | undefined, guests: number | null): boolean {
  if (guests == null) return true;
  if (maxGuests == null || maxGuests === undefined) return true;
  return guests <= maxGuests;
}

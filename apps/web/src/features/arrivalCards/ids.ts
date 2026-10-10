export const MAX_ARRIVAL_CARDS = 30;

/** The booking ids in `?ids=a,b,c`: trimmed, without repeats, at most 30. */
export function parseIds(param: string | string[] | undefined): string[] {
  const text = Array.isArray(param) ? param.join(",") : (param ?? "");
  const ids = text
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)].slice(0, MAX_ARRIVAL_CARDS);
}

/** The printable page for these bookings. */
export function arrivalCardsHref(ids: readonly string[]): string {
  return `/app/arrival-cards?ids=${ids.map(encodeURIComponent).join(",")}`;
}

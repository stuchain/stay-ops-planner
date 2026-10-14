import { apartment } from "./tokens";

/** The approved apartment colours (as stored on the room), mapped to their theme-aware CSS variable. */
const BY_HEX = new Map<string, string>(
  Object.values(apartment).map((a) => [a.color.toLowerCase(), `var(--so-apt-${a.name.toLowerCase()})`]),
);

/**
 * The colour to draw an apartment with on screen. The four approved colours follow the theme (a lighter step in
 * dark mode); any other stored colour is used as is; a room with no colour gets the muted text colour.
 * Not for the Excel export or anything printed, which keep the stored hex.
 */
export function apartmentColor(color: string | null | undefined): string {
  if (!color) return "var(--so-text-muted)";
  return BY_HEX.get(color.toLowerCase()) ?? color;
}

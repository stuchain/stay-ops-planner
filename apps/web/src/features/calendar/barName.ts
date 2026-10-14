/** Space a bar takes besides the name: padding, the channel logo and the gap after it. */
const BAR_CHROME = 60;
/** Rough width of one letter of the bar's bold 14px name. */
const LETTER = 8.5;

/**
 * The name to write on a bar `width` pixels wide: the whole name when it fits, otherwise the surname (last word),
 * so a short stay reads "Nowak" rather than "Anna ...". The full name stays in the bar's label and tooltip.
 */
export function barName(name: string, width: number | undefined): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (width === undefined || words.length < 2) return name;
  return name.trim().length * LETTER <= width - BAR_CHROME ? name : words[words.length - 1]!;
}

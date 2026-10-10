/**
 * Stay Ops Planner design tokens (Phase 1A, P1A-1).
 *
 * Source of truth for the new UI. `theme.css` exposes the same values to
 * Tailwind v4 as CSS variables (a unit test keeps the two in step), and the
 * clickable prototype in docs/design/prototype/ mirrors them too.
 *
 * Every text/background pair used below meets WCAG AA (4.5:1). Ratios are
 * noted next to the pairs that matter.
 */

export const font = {
  /** Commissioner: humanist sans with full Greek, drawn by a Greek type designer. */
  family: `"Commissioner", "Inter", "Segoe UI", system-ui, sans-serif`,
  /** Base size is 18 px; the user "Text size" setting scales the root. */
  size: { xs: 14, sm: 16, base: 18, lg: 22, xl: 28, xxl: 36 },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  lineHeight: { body: 1.5, heading: 1.25 },
  /** Root multipliers for the Text size setting: Κανονικά / Μεγάλα / Πολύ μεγάλα. */
  textScale: { normal: 1, large: 1.125, xlarge: 1.25 },
} as const;

export const space = {
  /** 8 px grid. */
  unit: 8,
  scale: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 },
} as const;

export const radius = { sm: 8, card: 12, pill: 999 } as const;

export const shadow = {
  card: "0 1px 2px rgba(28,27,25,.06), 0 2px 8px rgba(28,27,25,.06)",
  raised: "0 4px 12px rgba(28,27,25,.10), 0 12px 32px rgba(28,27,25,.10)",
} as const;

export const size = {
  /** Minimum click target for every interactive element. */
  target: 44,
  sidebarWidth: 240,
  contentMaxWidth: 1440,
  panelWidth: 420,
  calendarRowHeight: 88,
  /** Day column width per zoom level. */
  dayWidth: { week: 132, month: 44 },
} as const;

export const motion = {
  duration: { fast: 150, base: 200 },
  easing: "cubic-bezier(0.2, 0, 0, 1)", // ease-out
  /** Undo toast stays this long. */
  undoMs: 10_000,
} as const;

export const color = {
  light: {
    bg: "#F2F1EE", // warm grey page
    surface: "#FFFFFF", // cards, panel
    surfaceMuted: "#F8F7F5",
    border: "#E2E0DB",
    text: "#1C1B19", // 15.2:1 on bg
    textMuted: "#5B5852", // 6.3:1 on bg, 7.1:1 on white
    accent: "#1E4B8F", // deep blue; white text 8.5:1
    accentSoft: "#E7EEF8",
    success: "#15803D", // white text 5.0:1
    successSoft: "#DCFCE7",
    successText: "#14532D", // on successSoft 8.3:1
    warning: "#A65F00",
    warningSoft: "#FFF4DB",
    warningText: "#7A4A00", // on warningSoft 6.9:1
    danger: "#B42318", // white text 6.6:1
    dangerSoft: "#FDECEA",
    focus: "#1E4B8F",
  },
  dark: {
    bg: "#161616",
    surface: "#202020",
    surfaceMuted: "#1B1B1B",
    border: "#343330",
    text: "#F2F1EE",
    textMuted: "#B6B2AA",
    accent: "#8DB4F2",
    accentSoft: "#1D2A3F",
    success: "#4ADE80",
    successSoft: "#14301F",
    successText: "#BBF7D0",
    warning: "#F5B544",
    warningSoft: "#3A2A0E",
    warningText: "#FCD9A0",
    danger: "#F87171",
    dangerSoft: "#3B1717",
    focus: "#8DB4F2",
  },
} as const;

/**
 * One fixed colour per apartment, used everywhere: calendar row and bars,
 * chips, money bars and the Excel export. White bold text on each passes AA.
 */
export const apartment = {
  Onar: { name: "Onar", color: "#0F766E", soft: "#E6F4F2" }, // teal, 5.5:1
  Cosmos: { name: "Cosmos", color: "#4338CA", soft: "#ECEBFB" }, // indigo, 7.9:1
  Iris: { name: "Iris", color: "#BE185D", soft: "#FCE8F0" }, // rose, 6.0:1
  Helios: { name: "Helios", color: "#A65F00", soft: "#FFF1DC" }, // amber, 4.9:1
} as const;

export type ApartmentName = keyof typeof apartment;

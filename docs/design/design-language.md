# Design language

Phase 1A, task P1A-1. The rules every new screen follows. Values live in [`apps/web/src/ui/tokens.ts`](../../apps/web/src/ui/tokens.ts) (moved there in Phase 1B); the clickable prototype in [`prototype/`](./prototype/) uses the same values as CSS variables.

**Who it is for.** The main user is a 70-year-old owner of four apartments, working on a computer with a mouse. He places new bookings in an apartment, moves them when needed, checks who arrives and leaves, and looks at income. Stelios (admin) uses the same screens plus Dev mode, sometimes on a phone.

**What it should feel like.** A calm, paper-like desk: one thing at a time, large words, no codes, every action forgiving.

## Layout

- Desktop-first. Fixed left sidebar, 240 px, with 4 large items, icon plus label: **Σήμερα**, **Ημερολόγιο**, **Έσοδα**, **Ρυθμίσεις**. The current page has a filled background, not just a coloured icon.
- Content area up to 1440 px wide, 32 px padding.
- The booking panel opens **beside** the calendar (420 px on the right). The calendar shrinks; it is never covered, so he can see where the booking is going.
- Must work at 1366×768 and 1920×1080, and with browser zoom at 125% and 150%. Below 760 px wide (Stelios on a phone) the sidebar becomes bottom tabs and the panel covers the screen.

## Type

- Face: **Commissioner** (full Greek, designed by a Greek type designer), falling back to Inter, Segoe UI, system UI.
- Base 18 px. Scale: 14 / 16 / 18 / 22 / 28 / 36. Line height 1.5 for text, 1.25 for headings.
- Heading levels, always the same: page title 28 semibold (`PageHeader`), section 22 semibold (`Card` titles, day headings), group 18 semibold, big numbers 36 bold.
- 14 px only for secondary labels (day numbers, captions), never smaller, and never for something he must act on. One exception: the phone tab labels are 11 px so six tabs fit (phones are Stelios only).
- Printed documents (the accountant's report) are sized in pt so the paper looks the same whatever the screen's Text size.
- Text size setting: Κανονικά (100%), Μεγάλα (112.5%), Πολύ μεγάλα (125%), scaling everything.
- Numbers that line up use tabular figures.

## Colour

- Warm-grey page, white cards, one accent (deep blue) for primary buttons and the current page. Text on a blue or red fill uses `on-accent` (white in light, near-black in dark).
- Semantic colours: success (green, "free", "done"), warning (orange, "needs a decision"; orange so it never looks like Helios), danger (red, errors only).
- **One fixed colour per apartment, used everywhere** (calendar row labels, chips, money bars, Excel export). Booking bars are coloured by channel instead (Airbnb red, Booking.com blue, direct light yellow; Stelios, 11 Oct 2026). On screen, apartment colours go through `ui/apartmentColor.ts`, which gives a lighter step of the same hue in dark mode:

  | Apartment | Colour |
  |---|---|
  | Onar | teal `#0F766E` |
  | Cosmos | indigo `#4338CA` |
  | Iris | rose `#BE185D` |
  | Helios | amber `#A65F00` |

- Colour is never the only signal: every apartment colour comes with its name, every state with a word.
- All text meets WCAG AA (4.5:1); ratios are in `apps/web/src/ui/tokens.ts`. Light theme is the default. Admins can pick Φωτεινή / Σκούρα / Όπως η συσκευή in Settings (saved per user in `users.theme`), so the owner's screens stay light.
- Only colours defined in `ui/theme.css` exist (Tailwind's own list is reset); `tests/unit/ui/colourClasses.test.ts` fails on any other colour class. Printable sheets use `paper` / `ink`, black on white whatever the theme.

## Shape and space

- 4 px steps on an 8 px grid (4, 8, 12, 16, 24, 32, 48, 64); no 2, 6 or 10 px gaps.
- Corners: 4 px (`rounded-xs`) for small marks only (colour dots, chart bars), 8 px (`rounded-sm`) for buttons, fields and badges' inner parts, 12 px (`rounded-card`) for cards, panels and dialogs, pill for badges and chips.
- Cards have a soft shadow. Panels and dialogs use the stronger "raised" shadow.
- Breakpoints, by name only: `narrow` below 1100 px (side-by-side blocks stack), `phone` below 760 px (bottom tabs), `small` below 480 px.
- Minimum click target 44 px; main buttons 56 px tall. No action is only on hover.
- Settings-style pages (one column of forms) are at most 48 rem wide; every other screen uses the full content width.

## Components

- **Buttons:** one blue (primary) button per screen, for the thing the screen is for ("Βάλτε τις σε διαμέρισμα" on Σήμερα). Everything else is the plain (secondary) button. Print is plain, except on pages that exist only to print (the print sheet, arrival cards).
- **Choosing one of a few:** always `ui/ChoiceGroup` (light blue fill, blue border and a tick), in Settings, the calendar's Week/Month and the statistics tabs. `size="md"` in toolbars.
- **Small labels:** always `ui/Badge` with a tone: neutral (facts, "Εκτίμηση"), info ("Σήμερα", "Τώρα"), success (done), warning (needs him), danger.
- **Text boxes:** `fieldClass` from `ui/field.ts` (56 px, 2 px border) on his forms; `compactFieldClass` (44 px) in tables, toolbars and Dev screens.
- Booking bars are 56 px tall on 88 px rows, so they are easy to hit.

## Motion

- 150–200 ms ease-out. A moved booking slides to its new row; the panel slides in from the right; the toast rises from the bottom.
- With `prefers-reduced-motion`, everything changes instantly.

## Icons

Lucide only (no text arrows or ★ characters), 2 px stroke, always next to a word. Three sizes: 24 px in the sidebar, buttons and card titles; 20 px next to body text; 16 px next to small (14–16 px) text.

## Interaction rules

1. **Click, then choose.** Clicking a booking opens the panel with big "Μετακίνηση σε" buttons, one per apartment. Dragging a bar onto a row does the same thing and is a shortcut, never the only way.
2. **Show what will happen before it happens.** While a booking is selected or dragged, free apartments glow green ("Ελεύθερο") and busy ones say who is there ("Κλεισμένο: Νίκος Π.").
3. **One recommendation, with a reason in words.** "Προτείνεται: χωράει 4 άτομα".
4. **Undo instead of "Are you sure?"** After every move: "Μετακινήθηκε στο Cosmos · Αναίρεση", for 10 seconds.
5. **No dead ends.** Every empty state says what to do next. Every error says what happened and what to try.
6. **Pending bookings** are shown greyed with "Αναμένει επιβεβαίωση" and cannot be placed until confirmed.

## States the screens must show

From the edge-case audit (`foundation-review/edge-cases.md`, task ids in brackets):

| Situation | What he sees |
|---|---|
| Party bigger than the apartment (E1-2) | Allowed. The button and the row say "Μικρό: χωράει έως 3 άτομα" in amber; the undo message repeats the warning. |
| Moving a guest who has already arrived (E1-1) | The panel asks first: "Ο Γιώργος Α. μένει ήδη στο Onar από Σαβ 10 Οκτ. Να μετακινηθεί στο Helios για τις υπόλοιπες νύχτες;" with "Ναι, μετακίνηση" and "Όχι". |
| Stay already over | No move buttons; "Η διαμονή τελείωσε …, οπότε δεν μετακινείται." |
| Apartment switched off but holding bookings (E0-9, E1-18) | The row stays, greyed, labelled "Απενεργοποιημένο"; nothing new can be placed there. |
| More stays than apartments on a night (E1-6) | A red marker on that night in the calendar and a card on Σήμερα. |
| Booking reactivated in Hosthub (E1-11) | It returns to the tray with "Η κράτηση ενεργοποιήθηκε ξανά". |
| Guest changed listing in Hosthub (E1-13) | The placement stays; a note "Άλλαξε καταχώριση στο Hosthub" on the booking and in the tray. |
| Cancelled booking | Leaves the calendar and the tray; never counted in Έσοδα unless a fee was paid (Phase 3). |

## Copy rules

- Greek first. English is an option in Settings.
- One word per concept, always the same:

  | Concept | Word |
  |---|---|
  | apartment | Διαμέρισμα |
  | booking | Κράτηση |
  | arrival / departure | Άφιξη / Αναχώρηση |
  | income | Έσοδα |
  | needs an apartment | Χρειάζεται διαμέρισμα |
  | move to | Μετακίνηση σε |
  | undo | Αναίρεση |

- Dates as "Παρ 17 Οκτ"; ranges as "Παρ 17 – Τρι 21 Οκτ"; nights as "4 νύχτες".
- Money as "1.250 €" (dot for thousands, euro sign after a space).
- Sentences a person would say: "Το Helios είναι κλεισμένο εκείνες τις μέρες. Δοκιμάστε το Cosmos." Never codes (`pending`, `needs_reassignment`), never server text, never English on his screens.
- Buttons say what happens: "Μετακίνηση στο Cosmos", not "OK".

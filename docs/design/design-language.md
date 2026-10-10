# Design language

Phase 1A, task P1A-1. The rules every new screen follows. Values live in [`tokens.ts`](./tokens.ts); the clickable prototype in [`prototype/`](./prototype/) uses the same values as CSS variables.

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
- 14 px only for secondary labels (day numbers, captions), never for something he must act on.
- Text size setting: Κανονικά (100%), Μεγάλα (112.5%), Πολύ μεγάλα (125%), scaling everything.
- Numbers that line up use tabular figures.

## Colour

- Warm-grey page, white cards, one accent (deep blue) for primary buttons and the current page.
- Semantic colours: success (green, "free", "done"), warning (amber, "needs a decision"), danger (red, errors only).
- **One fixed colour per apartment, used everywhere** (calendar row and bars, chips, money bars, Excel export):

  | Apartment | Colour |
  |---|---|
  | Onar | teal `#0F766E` |
  | Cosmos | indigo `#4338CA` |
  | Iris | rose `#BE185D` |
  | Helios | amber `#A65F00` |

- Colour is never the only signal: every apartment colour comes with its name, every state with a word.
- All text meets WCAG AA (4.5:1); ratios are in `tokens.ts`. Light theme is the default; a dark theme exists for Stelios.

## Shape and space

- 8 px grid. Cards have 12 px radius and a soft shadow. Panels and dialogs use the stronger "raised" shadow.
- Minimum click target 44 px; main buttons 56 px tall. No action is only on hover.
- Booking bars are 56 px tall on 88 px rows, so they are easy to hit.

## Motion

- 150–200 ms ease-out. A moved booking slides to its new row; the panel slides in from the right; the toast rises from the bottom.
- With `prefers-reduced-motion`, everything changes instantly.

## Icons

Lucide only, 24 px in the sidebar and buttons, 2 px stroke, always next to a word.

## Interaction rules

1. **Click, then choose.** Clicking a booking opens the panel with big "Μετακίνηση σε" buttons, one per apartment. Dragging a bar onto a row does the same thing and is a shortcut, never the only way.
2. **Show what will happen before it happens.** While a booking is selected or dragged, free apartments glow green ("Ελεύθερο") and busy ones say who is there ("Κλεισμένο: Νίκος Π.").
3. **One recommendation, with a reason in words.** "Προτείνεται: χωράει 4 άτομα".
4. **Undo instead of "Are you sure?"** After every move: "Μετακινήθηκε στο Cosmos · Αναίρεση", for 10 seconds.
5. **No dead ends.** Every empty state says what to do next. Every error says what happened and what to try.
6. **Pending bookings** are shown greyed with "Αναμένει επιβεβαίωση" and cannot be placed until confirmed.

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

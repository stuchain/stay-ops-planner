import { addDays, daysBetween, type IsoDate } from "./stay.js";

/**
 * The family's own calendar in Excel (Φύλλο1): every night, each apartment's cell holds the guest's name and how
 * many they are ("TODNER 2"). This turns those cells into stays and finds the booking each one is.
 */

/** One filled cell: the text written in an apartment's column (0 = the first apartment) for one night. */
export type PaperNight = { readonly date: IsoDate; readonly apartment: number; readonly text: string };

/** Nights `[start, end)` in one apartment. */
export type PaperPart = { readonly apartment: number; readonly start: IsoDate; readonly end: IsoDate };

/** A guest's stay as written in the calendar, in one apartment or, for a guest who moved, several. */
export type PaperStay = {
  /** The name as written, without the number of guests. */
  readonly name: string;
  /** The name in plain capital Latin letters, without spaces: what the nights of one stay share. */
  readonly key: string;
  readonly guests: number | null;
  readonly start: IsoDate;
  readonly end: IsoDate;
  readonly parts: readonly PaperPart[];
};

const GREEK: Readonly<Record<string, string>> = {
  Α: "A",
  Β: "V",
  Γ: "G",
  Δ: "D",
  Ε: "E",
  Ζ: "Z",
  Η: "I",
  Θ: "TH",
  Ι: "I",
  Κ: "K",
  Λ: "L",
  Μ: "M",
  Ν: "N",
  Ξ: "X",
  Ο: "O",
  Π: "P",
  Ρ: "R",
  Σ: "S",
  Τ: "T",
  Υ: "Y",
  Φ: "F",
  Χ: "CH",
  Ψ: "PS",
  Ω: "O",
};

const GREEK_LETTER = new RegExp(`[${Object.keys(GREEK).join("")}]`, "g");

/** Capital Latin words: accents dropped, Greek letters spelled in Latin, digits and signs gone. */
export function nameWords(text: string): string[] {
  const plain = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/ΟΥ/g, "OU")
    .replace(GREEK_LETTER, (c) => GREEK[c]!)
    // A zero typed for the letter O ("M0LLOY").
    .replace(/(?<=[A-Z])0(?=[A-Z])/g, "O")
    .replace(/[^A-Z]+/g, " ");
  return plain.split(" ").filter((w) => w.length > 0);
}

function splitGuests(text: string): { name: string; guests: number | null } {
  const clean = text.replace(/\s+/g, " ").trim();
  const match = /^(.*?)\s*(\d+)$/.exec(clean);
  if (match && match[1]) return { name: match[1], guests: Number(match[2]) };
  return { name: clean, guests: null };
}

/**
 * Stays from the calendar's nights. Nights next to each other in one apartment with the same name are one part;
 * a part that starts the day another with the same name ends, in another apartment, is the same guest moving.
 */
export function paperStays(nights: readonly PaperNight[]): PaperStay[] {
  type Open = { name: string; key: string; guests: number | null; parts: PaperPart[] };
  const parts: { key: string; name: string; guests: number | null; part: PaperPart }[] = [];
  const sorted = [...nights].sort((a, b) => a.apartment - b.apartment || (a.date < b.date ? -1 : 1));
  for (const n of sorted) {
    const { name, guests } = splitGuests(n.text);
    const key = nameWords(name).join("");
    if (!key) continue;
    const last = parts[parts.length - 1];
    if (last && last.key === key && last.part.apartment === n.apartment && last.part.end === n.date) {
      last.part = { ...last.part, end: addDays(n.date, 1) };
      last.guests ??= guests;
    } else {
      parts.push({ key, name, guests, part: { apartment: n.apartment, start: n.date, end: addDays(n.date, 1) } });
    }
  }
  parts.sort((a, b) => (a.part.start < b.part.start ? -1 : a.part.start > b.part.start ? 1 : 0));
  const stays: Open[] = [];
  for (const p of parts) {
    const moving = stays.find((s) => s.key === p.key && s.parts[s.parts.length - 1]!.end === p.part.start);
    if (moving) {
      moving.parts.push(p.part);
      moving.guests ??= p.guests;
    } else stays.push({ name: p.name, key: p.key, guests: p.guests, parts: [p.part] });
  }
  return stays.map((s) => ({
    ...s,
    start: s.parts[0]!.start,
    end: s.parts[s.parts.length - 1]!.end,
  }));
}

function editSimilarity(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - row[b.length]! / Math.max(a.length, b.length);
}

/**
 * How alike a name in the calendar and a booking's guest name are, 0 to 1. The calendar usually has only the
 * surname, often misspelled ("NENTWING" for Olaf Nentwig), so the best matching word counts.
 */
export function nameLikeness(paperName: string, guestName: string): number {
  const a = nameWords(paperName);
  const b = nameWords(guestName);
  if (a.length === 0 || b.length === 0) return 0;
  const joinedA = a.join("");
  const joinedB = b.join("");
  if (joinedA.length >= 4 && joinedB.includes(joinedA)) return 1;
  let best = editSimilarity(joinedA, joinedB);
  for (const x of a) {
    for (const y of b) {
      if (Math.min(x.length, y.length) < 3) continue;
      best = Math.max(best, editSimilarity(x, y));
    }
  }
  return best;
}

export type PaperBooking = {
  readonly id: string;
  readonly guestName: string | null;
  readonly checkin: IsoDate;
  readonly checkout: IsoDate;
};

/** `sure`: the name and dates agree. `dates`: the name agrees, the dates differ. `name`: only the dates agree. */
export type PaperMatchKind = "sure" | "dates" | "name";

export type PaperMatch = {
  readonly stay: PaperStay;
  readonly bookingId: string | null;
  readonly kind: PaperMatchKind | null;
};

/** A name this alike is the same guest. */
export const SAME_NAME = 0.7;

/**
 * The booking each calendar stay is, at most one stay per booking. A booking must share nights with the stay and
 * either have a similar name, or have exactly the same dates. The best pairs are taken first.
 */
export function matchPaperStays(stays: readonly PaperStay[], bookings: readonly PaperBooking[]): PaperMatch[] {
  const pairs: { stay: number; booking: PaperBooking; score: number; kind: PaperMatchKind }[] = [];
  stays.forEach((s, i) => {
    for (const b of bookings) {
      const shared = daysBetween(s.start < b.checkin ? b.checkin : s.start, s.end > b.checkout ? b.checkout : s.end);
      if (shared <= 0) continue;
      const name = nameLikeness(s.name, b.guestName ?? "");
      const sameDates = s.start === b.checkin && s.end === b.checkout;
      if (name < SAME_NAME && !sameDates) continue;
      const kind: PaperMatchKind = name < SAME_NAME ? "name" : sameDates ? "sure" : "dates";
      const span = daysBetween(s.start < b.checkin ? s.start : b.checkin, s.end > b.checkout ? s.end : b.checkout);
      pairs.push({ stay: i, booking: b, score: name + shared / span, kind });
    }
  });
  pairs.sort((x, y) => y.score - x.score);
  const found = new Map<number, { bookingId: string; kind: PaperMatchKind }>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (found.has(p.stay) || used.has(p.booking.id)) continue;
    found.set(p.stay, { bookingId: p.booking.id, kind: p.kind });
    used.add(p.booking.id);
  }
  return stays.map((stay, i) => {
    const f = found.get(i);
    return { stay, bookingId: f?.bookingId ?? null, kind: f?.kind ?? null };
  });
}

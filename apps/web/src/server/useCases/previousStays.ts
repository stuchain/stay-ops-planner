import { BookingStatus } from "@stay-ops/db";
import { DomainError, type IsoDate } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { dbDateToIso } from "@/server/time";

/** One earlier stay of the same guest. */
export type PreviousStay = {
  bookingId: string;
  /** First night of that stay. */
  checkin: IsoDate;
  /** The apartment it was in; null when it had none. */
  apartment: string | null;
  /** The team's note about the guest from that stay, if any. */
  note: string | null;
};

export type PreviousStays = {
  /** Same phone number or e-mail: almost certainly the same guest. Most recent first. */
  sure: PreviousStay[];
  /** Only the name is the same (and no phone or e-mail matched): a hint. Most recent first. */
  maybe: PreviousStay[];
};

const MAX_LISTED = 20;

type Identity = { name: string | null; phone: string | null; email: string | null };

/** Digits of a phone number, compared by their last 10; null when fewer than 7 digits. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length < 7 ? null : digits.slice(-10);
}

export function emailKey(email: string | null | undefined): string | null {
  const value = (email ?? "").trim().toLowerCase();
  return value === "" ? null : value;
}

/** Lower case, no accents (Greek included), final sigma as sigma, single spaces. Null when under two words. */
export function nameKey(name: string | null | undefined): string | null {
  const words = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return words.length < 2 ? null : words.join(" ");
}

export type Candidate = Identity & {
  bookingId: string;
  checkin: IsoDate;
  apartment: string | null;
  note?: string | null;
};

/** Pure matching of one guest against earlier bookings (already limited to ones that ended before). */
export function matchPreviousStays(guest: Identity, candidates: Candidate[]): PreviousStays {
  const phone = phoneKey(guest.phone);
  const email = emailKey(guest.email);
  const name = nameKey(guest.name);
  const sure: PreviousStay[] = [];
  const maybe: PreviousStay[] = [];
  for (const c of candidates) {
    const stay: PreviousStay = {
      bookingId: c.bookingId,
      checkin: c.checkin,
      apartment: c.apartment,
      note: c.note ?? null,
    };
    if ((phone !== null && phone === phoneKey(c.phone)) || (email !== null && email === emailKey(c.email))) {
      sure.push(stay);
    } else if (name !== null && name === nameKey(c.name)) {
      maybe.push(stay);
    }
  }
  const recentFirst = (a: PreviousStay, b: PreviousStay) =>
    a.checkin < b.checkin ? 1 : a.checkin > b.checkin ? -1 : 0;
  return {
    sure: sure.sort(recentFirst).slice(0, MAX_LISTED),
    maybe: maybe.sort(recentFirst).slice(0, MAX_LISTED),
  };
}

/** Earlier stays for several bookings with one read of the history. */
export async function previousStaysForMany(bookingIds: string[]): Promise<Map<string, PreviousStays>> {
  const result = new Map<string, PreviousStays>();
  if (bookingIds.length === 0) return result;
  const guests = await prisma.booking.findMany({
    where: { id: { in: bookingIds } },
    select: { id: true, checkinDate: true, guestName: true, guestPhone: true, guestEmail: true },
  });
  if (guests.length === 0) return result;
  const latest = guests.reduce((max, g) => (g.checkinDate > max ? g.checkinDate : max), guests[0]!.checkinDate);
  const history = await prisma.booking.findMany({
    where: { status: { not: BookingStatus.cancelled }, checkoutDate: { lte: latest } },
    select: {
      id: true,
      checkinDate: true,
      checkoutDate: true,
      guestName: true,
      guestPhone: true,
      guestEmail: true,
      guestNote: true,
      assignments: {
        orderBy: { startDate: "asc" },
        take: 1,
        select: { room: { select: { displayName: true, code: true } } },
      },
    },
  });
  for (const guest of guests) {
    const candidates: Candidate[] = history
      .filter((h) => h.id !== guest.id && h.checkoutDate <= guest.checkinDate)
      .map((h) => ({
        bookingId: h.id,
        checkin: dbDateToIso(h.checkinDate),
        apartment: h.assignments[0] ? (h.assignments[0].room.displayName ?? h.assignments[0].room.code) : null,
        name: h.guestName,
        phone: h.guestPhone,
        email: h.guestEmail,
        note: h.guestNote,
      }));
    result.set(
      guest.id,
      matchPreviousStays({ name: guest.guestName, phone: guest.guestPhone, email: guest.guestEmail }, candidates),
    );
  }
  return result;
}

/** Earlier stays of the guest of one booking. */
export async function getPreviousStays(bookingId: string): Promise<PreviousStays> {
  const found = (await previousStaysForMany([bookingId])).get(bookingId);
  if (!found) throw new DomainError("NOT_FOUND");
  return found;
}

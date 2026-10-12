import { Prisma, type BookingStatus, type Channel } from "@stay-ops/db";
import type { IsoDate } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { dbDateToIso, isoToDbDate } from "@/server/time";
import { partyOf } from "./bookingSlice";

/** One booking found by the search. */
export type SearchResult = {
  id: string;
  guestName: string | null;
  phone: string | null;
  checkin: IsoDate;
  checkout: IsoDate;
  nights: number;
  partySize: number | null;
  channel: Channel;
  status: BookingStatus;
  room: { id: string; name: string; color: string | null } | null;
};

export type SearchInput = {
  /** Guest name, phone or e-mail, in any case and with or without Greek accents. */
  text?: string | undefined;
  /** Stays that include any night from `from` up to and including `to`. Either alone means that one day. */
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
  includeCancelled?: boolean | undefined;
};

export type SearchOutput = {
  results: SearchResult[];
  /** True when more bookings matched than are listed. */
  more: boolean;
};

export const SEARCH_LIMIT = 50;

/** Lower case, no accents (Greek included) and final sigma as sigma; the database side does the same in SQL. */
export function searchKey(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ").trim();
}

const ACCENTED = "άέήίόύώϊϋΐΰς";
const PLAIN = "αεηιουωιυιυσ";

/** The same folding as `searchKey`, for a text column. */
function folded(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`translate(lower(coalesce(${column}, '')), ${ACCENTED}, ${PLAIN})`;
}

/** What one typed word must match: the name, the e-mail, or (when it has digits) the phone number. */
function wordCondition(word: string): Prisma.Sql {
  const like = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  // Compared by the last 10 digits, so "+30 691…" also finds a number saved without the country code.
  const digits = word.replace(/\D/g, "").slice(-10);
  const phone =
    digits.length >= 3 && /^\+?\d+$/.test(word)
      ? Prisma.sql` OR regexp_replace(coalesce(b.guest_phone, ''), '\\D', '', 'g') LIKE ${`%${digits}%`}`
      : Prisma.empty;
  return Prisma.sql`(${folded(Prisma.sql`b.guest_name`)} LIKE ${like} OR lower(coalesce(b.guest_email, '')) LIKE ${like}${phone})`;
}

/** The words of the typed text; a phone number typed with spaces stays one word. */
export function searchWords(text: string): string[] {
  const key = searchKey(text);
  if (key === "") return [];
  if (/^[\d\s+()-]+$/.test(key)) return [key.replace(/[\s()-]/g, "")];
  return key.split(/\s+/).filter(Boolean);
}

/**
 * Bookings by guest name, phone, e-mail and/or dates, past and future, newest stay first. With nothing to search
 * for there are no results.
 */
export async function searchBookings(input: SearchInput): Promise<SearchOutput> {
  const words = searchWords(input.text ?? "");
  const from = input.from ?? input.to;
  const to = input.to ?? input.from;
  if (words.length === 0 && !from) return { results: [], more: false };

  const conditions: Prisma.Sql[] = words.map(wordCondition);
  if (from && to) {
    const [first, last] = from <= to ? [from, to] : [to, from];
    // A stay covers the nights from check-in up to the day before check-out.
    conditions.push(
      Prisma.sql`b.checkin_date <= ${isoToDbDate(last)}::date AND b.checkout_date > ${isoToDbDate(first)}::date`,
    );
  }
  if (!input.includeCancelled) conditions.push(Prisma.sql`b.status <> 'cancelled'`);

  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT b.id FROM bookings b
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY b.checkin_date DESC, b.id
    LIMIT ${SEARCH_LIMIT + 1}
  `;
  const more = ids.length > SEARCH_LIMIT;
  const wanted = ids.slice(0, SEARCH_LIMIT).map((r) => r.id);
  if (wanted.length === 0) return { results: [], more: false };

  const rows = await prisma.booking.findMany({
    where: { id: { in: wanted } },
    select: {
      id: true,
      guestName: true,
      guestPhone: true,
      checkinDate: true,
      checkoutDate: true,
      guestAdults: true,
      guestChildren: true,
      guestInfants: true,
      guestTotal: true,
      channel: true,
      status: true,
      assignment: { select: { room: { select: { id: true, displayName: true, code: true, color: true } } } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const results = wanted.flatMap((id): SearchResult[] => {
    const row = byId.get(id);
    if (!row) return [];
    const party = partyOf(row);
    const room = row.assignment?.room;
    const checkin = dbDateToIso(row.checkinDate);
    const checkout = dbDateToIso(row.checkoutDate);
    return [
      {
        id: row.id,
        guestName: row.guestName,
        phone: row.guestPhone,
        checkin,
        checkout,
        nights: Math.round((row.checkoutDate.getTime() - row.checkinDate.getTime()) / 86_400_000),
        partySize: party === null ? null : party.adults + party.children,
        channel: row.channel,
        status: row.status,
        room: room ? { id: room.id, name: room.displayName ?? room.code ?? room.id, color: room.color } : null,
      },
    ];
  });
  return { results, more };
}

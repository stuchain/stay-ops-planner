import {
  effectiveGuestCount,
  type GuestCountFields,
  roomAcceptsParty,
} from "@/modules/bookings/effectiveGuestCount";
import type { CalendarBlockItem, CalendarBookingItem } from "./calendarTypes";
import { bookingSpanFromStayDates } from "./monthSpan";

export type Span = { start: number; endExclusive: number };

export type CalendarRoomOption = {
  id: string;
  label: string;
  maxGuests: number | null;
};

function dayOfMonthIso(iso: string): number {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.getUTCDate();
}

export function bookingSpanInMonth(
  item: CalendarBookingItem,
  month: string,
  monthDayCount: number,
): Span {
  const s = bookingSpanFromStayDates(item.startDate, item.endDate, month, monthDayCount);
  return { start: s.start, endExclusive: s.endExclusive };
}

export function blockSpanInMonth(
  block: CalendarBlockItem,
  month: string,
  monthDayCount: number,
): Span {
  const blockStartMonth = block.startDate.slice(0, 7);
  const blockEndMonth = block.endDate.slice(0, 7);
  return {
    start: blockStartMonth === month ? Math.max(1, dayOfMonthIso(block.startDate)) : 1,
    endExclusive:
      blockEndMonth === month
        ? Math.min(monthDayCount + 1, dayOfMonthIso(block.endDate))
        : monthDayCount + 1,
  };
}

export function spansOverlap(a: Span, b: Span): boolean {
  if (a.endExclusive <= a.start || b.endExclusive <= b.start) return false;
  return a.start < b.endExclusive && b.start < a.endExclusive;
}

export function roomFreeForStay(
  roomId: string,
  checkinDate: string,
  checkoutDate: string,
  month: string,
  monthDayCount: number,
  bookings: CalendarBookingItem[],
  blocks: CalendarBlockItem[],
): boolean {
  const stay = bookingSpanFromStayDates(checkinDate, checkoutDate, month, monthDayCount);
  if (stay.endExclusive <= stay.start) return true;

  for (const b of bookings) {
    if (b.roomId !== roomId) continue;
    if (spansOverlap(stay, bookingSpanInMonth(b, month, monthDayCount))) return false;
  }
  for (const blk of blocks) {
    if (blk.roomId !== roomId) continue;
    if (spansOverlap(stay, blockSpanInMonth(blk, month, monthDayCount))) return false;
  }
  return true;
}

/**
 * Default room for manual assign UI: calendar-free, fits maxGuests, then Helios/Cosmos tie-break for parties of 3–4.
 */
export function suggestDefaultRoomForBooking(
  guestFields: GuestCountFields,
  rooms: CalendarRoomOption[],
  checkinDate: string,
  checkoutDate: string,
  month: string,
  monthDayCount: number,
  bookings: CalendarBookingItem[],
  blocks: CalendarBlockItem[],
): string | undefined {
  const guests = effectiveGuestCount(guestFields);
  const eligible = rooms.filter(
    (r) =>
      roomFreeForStay(r.id, checkinDate, checkoutDate, month, monthDayCount, bookings, blocks) &&
      roomAcceptsParty(r.maxGuests, guests),
  );
  if (eligible.length === 0) return undefined;

  const hel = eligible.find((r) => /\bhelios\b/i.test(r.label.trim()));
  const cos = eligible.find((r) => /\bcosmos\b/i.test(r.label.trim()));
  if (guests === 3 || guests === 4) {
    for (const r of [hel, cos]) {
      if (r) return r.id;
    }
  }
  return eligible[0]?.id;
}

/** @deprecated Prefer {@link suggestDefaultRoomForBooking} with full guest fields and room maxGuests. */
export function suggestRoomIdForGuests34(
  guestTotal: number | null | undefined,
  rooms: Array<{ id: string; label: string; maxGuests?: number | null }>,
  checkinDate: string,
  checkoutDate: string,
  month: string,
  monthDayCount: number,
  bookings: CalendarBookingItem[],
  blocks: CalendarBlockItem[],
): string | undefined {
  const normalized: CalendarRoomOption[] = rooms.map((r) => ({
    id: r.id,
    label: r.label,
    maxGuests: r.maxGuests ?? null,
  }));
  return suggestDefaultRoomForBooking(
    { guestTotal },
    normalized,
    checkinDate,
    checkoutDate,
    month,
    monthDayCount,
    bookings,
    blocks,
  );
}

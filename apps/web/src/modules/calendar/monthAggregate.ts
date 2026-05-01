import { BookingStatus, Channel } from "@stay-ops/db";
import { prisma } from "@/lib/prisma";
import { extractDailyRatesFromHosthubJson } from "./hosthubDailyRates";
import { zonedMonthRangeUtc } from "./monthBounds";

export type CalendarBookingItem = {
  kind: "booking";
  id: string;
  roomId: string | null;
  startDate: string;
  endDate: string;
  guestName: string;
  guestTotal: number | null;
  guestAdults: number | null;
  guestChildren: number | null;
  guestInfants: number | null;
  channel: Channel;
  status: BookingStatus;
  assignmentId: string | null;
  /** Present when assigned; required for reassign/unassign mutations. */
  assignmentVersion: number | null;
  flags: string[];
};

export type CalendarBlockItem = {
  kind: "block";
  id: string;
  roomId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

export type CalendarMarker = {
  kind: "import_error";
  bookingId: string | null;
  severity: "warning" | "error";
  message: string;
  code: string | null;
};

export type CalendarRoomDto = {
  id: string;
  code: string | null;
  name: string | null;
  isActive: boolean;
  maxGuests: number | null;
};

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function guestNameFromRaw(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "Guest";
  const o = raw as Record<string, unknown>;
  const guest = o.guest ?? o.guest_name ?? o.customer ?? o.guestName;
  if (typeof guest === "string" && guest.trim()) return guest.trim();
  if (guest && typeof guest === "object") {
    const g = guest as Record<string, unknown>;
    const n = g.name ?? g.full_name;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  return "Guest";
}

function bestGuestName(booking: { guestName: string | null; rawPayload: unknown }): string {
  const fromColumn = booking.guestName?.trim();
  if (fromColumn) return fromColumn;
  return guestNameFromRaw(booking.rawPayload);
}

function bookingIdFromImportPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  const id = o.bookingId ?? o.booking_id;
  if (typeof id === "string" && id.length > 0) return id;
  return null;
}

export type DailyRatesByRoomDay = Record<
  string,
  Record<string, { amountCents: number; currency: string }>
>;

export async function getCalendarMonthAggregate(args: {
  yearMonth: string;
  timeZone: string;
}): Promise<{
  month: string;
  timezone: string;
  rooms: CalendarRoomDto[];
  items: (CalendarBookingItem | CalendarBlockItem)[];
  markers: CalendarMarker[];
  dailyRatesByRoomDay: DailyRatesByRoomDay;
}> {
  const { monthStartUtc, monthEndExclusiveUtc } = zonedMonthRangeUtc(args.yearMonth, args.timeZone);

  const roomsRaw = await prisma.room.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      displayName: true,
      isActive: true,
      calendarSortIndex: true,
      maxGuests: true,
    },
  });

  const roomsSorted = [...roomsRaw].sort((a, b) => {
    const ai = a.calendarSortIndex ?? Number.MAX_SAFE_INTEGER;
    const bi = b.calendarSortIndex ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    const ac = a.code ?? "";
    const bc = b.code ?? "";
    if (ac !== bc) return ac.localeCompare(bc);
    return a.id.localeCompare(b.id);
  });

  const allRoomDtos: CalendarRoomDto[] = roomsSorted.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.displayName,
    isActive: r.isActive,
    maxGuests: r.maxGuests,
  }));

  const bookings = await prisma.booking.findMany({
    where: {
      AND: [
        { checkinDate: { lt: monthEndExclusiveUtc } },
        { checkoutDate: { gt: monthStartUtc } },
        /* Cancelled stays remain in DB for history; hide from the operational month grid (avoids “duplicate” bars next to the active booking). */
        { status: { not: BookingStatus.cancelled } },
      ],
    },
    orderBy: [{ checkinDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      checkinDate: true,
      checkoutDate: true,
      guestName: true,
      guestTotal: true,
      guestAdults: true,
      guestChildren: true,
      guestInfants: true,
      rawPayload: true,
      channel: true,
      status: true,
      hosthubCalendarEventRaw: true,
      assignment: true,
      sourceListing: true,
    },
  });

  const blocks = await prisma.manualBlock.findMany({
    where: {
      AND: [{ startDate: { lt: monthEndExclusiveUtc } }, { endDate: { gte: monthStartUtc } }],
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });

  const importErrors = await prisma.importError.findMany({
    where: {
      resolved: false,
      createdAt: { gte: monthStartUtc, lt: monthEndExclusiveUtc },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const bookingItems: CalendarBookingItem[] = bookings.map((b) => {
    const a = b.assignment;
    const flags: string[] = [];
    if (!a) flags.push("unassigned");
    if (b.status === BookingStatus.needs_reassignment) flags.push("needs_reassignment");

    const startDate = a ? a.startDate : b.checkinDate;
    const endDate = a ? a.endDate : b.checkoutDate;

    return {
      kind: "booking" as const,
      id: b.id,
      roomId: a ? a.roomId : null,
      startDate: dateStr(startDate),
      endDate: dateStr(endDate),
      guestName: bestGuestName(b),
      guestTotal: b.guestTotal ?? null,
      guestAdults: b.guestAdults ?? null,
      guestChildren: b.guestChildren ?? null,
      guestInfants: b.guestInfants ?? null,
      channel: b.channel,
      status: b.status,
      assignmentId: a?.id ?? null,
      assignmentVersion: a?.version ?? null,
      flags,
    };
  });

  const dailyRatesByRoomDay: DailyRatesByRoomDay = {};
  for (const b of bookings) {
    const a = b.assignment;
    if (!a || !b.hosthubCalendarEventRaw) continue;
    const extracted = extractDailyRatesFromHosthubJson(b.hosthubCalendarEventRaw);
    if (extracted.size === 0) continue;
    const roomId = a.roomId;
    if (!dailyRatesByRoomDay[roomId]) dailyRatesByRoomDay[roomId] = {};
    const dest = dailyRatesByRoomDay[roomId];
    for (const [d, cell] of extracted) {
      if (dest[d] === undefined) dest[d] = cell;
    }
  }

  const blockItems: CalendarBlockItem[] = blocks.map((blk) => ({
    kind: "block" as const,
    id: blk.id,
    roomId: blk.roomId,
    startDate: dateStr(blk.startDate),
    endDate: dateStr(blk.endDate),
    reason: blk.reason,
  }));

  const markers: CalendarMarker[] = importErrors.map((e) => ({
    kind: "import_error" as const,
    bookingId: bookingIdFromImportPayload(e.payload),
    severity: "warning" as const,
    message: e.message,
    code: e.code,
  }));

  const items: (CalendarBookingItem | CalendarBlockItem)[] = [...bookingItems, ...blockItems].sort(
    (x, y) => {
      const xs = x.startDate;
      const ys = y.startDate;
      if (xs !== ys) return xs.localeCompare(ys);
      const k = x.kind.localeCompare(y.kind);
      if (k !== 0) return k;
      return x.id.localeCompare(y.id);
    },
  );

  const roomDtos: CalendarRoomDto[] = allRoomDtos;

  return {
    month: args.yearMonth,
    timezone: args.timeZone,
    rooms: roomDtos,
    items,
    markers,
    dailyRatesByRoomDay,
  };
}

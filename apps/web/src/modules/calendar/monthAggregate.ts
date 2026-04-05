import { BookingStatus, PrismaClient } from "@stay-ops/db";
import { zonedMonthRangeUtc } from "./monthBounds";

const prisma = new PrismaClient();

export type CalendarBookingItem = {
  kind: "booking";
  id: string;
  roomId: string | null;
  startDate: string;
  endDate: string;
  guestName: string;
  status: BookingStatus;
  assignmentId: string | null;
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

function bookingIdFromImportPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  const id = o.bookingId ?? o.booking_id;
  if (typeof id === "string" && id.length > 0) return id;
  return null;
}

export async function getCalendarMonthAggregate(args: {
  yearMonth: string;
  timeZone: string;
}): Promise<{
  month: string;
  timezone: string;
  rooms: CalendarRoomDto[];
  items: (CalendarBookingItem | CalendarBlockItem)[];
  markers: CalendarMarker[];
}> {
  const { monthStartUtc, monthEndExclusiveUtc } = zonedMonthRangeUtc(args.yearMonth, args.timeZone);

  const rooms = await prisma.room.findMany({
    orderBy: [{ isActive: "desc" }, { code: "asc" }, { id: "asc" }],
    select: { id: true, code: true, displayName: true, isActive: true },
  });

  const roomDtos: CalendarRoomDto[] = rooms.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.displayName,
    isActive: r.isActive,
  }));

  const bookings = await prisma.booking.findMany({
    where: {
      AND: [
        { checkinDate: { lt: monthEndExclusiveUtc } },
        { checkoutDate: { gt: monthStartUtc } },
      ],
    },
    include: { assignment: true },
    orderBy: [{ checkinDate: "asc" }, { id: "asc" }],
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
      guestName: guestNameFromRaw(b.rawPayload),
      status: b.status,
      assignmentId: a?.id ?? null,
      flags,
    };
  });

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

  return {
    month: args.yearMonth,
    timezone: args.timeZone,
    rooms: roomDtos,
    items,
    markers,
  };
}

import type { CalendarBookingItem, CalendarMonthPayload } from "./calendarTypes";

/** Apply a booking lane move locally (before server confirms). */
export function applyOptimisticBookingMove(
  payload: CalendarMonthPayload,
  bookingId: string,
  toRoomId: string | null,
): CalendarMonthPayload {
  return {
    ...payload,
    items: payload.items.map((item) => {
      if (item.kind !== "booking" || item.id !== bookingId) return item;
      const unassigned = toRoomId === null;
      const flags = new Set(item.flags);
      if (unassigned) flags.add("unassigned");
      else flags.delete("unassigned");
      return {
        ...item,
        roomId: toRoomId,
        assignmentId: unassigned ? null : item.assignmentId,
        assignmentVersion: unassigned ? null : item.assignmentVersion,
        flags: [...flags],
      };
    }),
  };
}

export type CalendarDataByMonth = Record<string, CalendarMonthPayload>;

/** Every copy of one booking, keyed by the month it appears in. */
export type BookingItemSnapshot = Record<string, CalendarBookingItem>;

function findBooking(payload: CalendarMonthPayload, bookingId: string): CalendarBookingItem | null {
  for (const item of payload.items) {
    if (item.kind === "booking" && item.id === bookingId) return item;
  }
  return null;
}

/** Copies of the booking in each loaded month, taken before an optimistic move. */
export function snapshotBookingInMonths(
  dataByMonth: CalendarDataByMonth,
  bookingId: string,
): BookingItemSnapshot {
  const out: BookingItemSnapshot = {};
  for (const [ym, payload] of Object.entries(dataByMonth)) {
    const item = findBooking(payload, bookingId);
    if (item) out[ym] = structuredClone(item);
  }
  return out;
}

/** Apply a move to every month that contains the booking, so a booking spanning months moves everywhere at once. */
export function applyOptimisticBookingMoveToMonths(
  dataByMonth: CalendarDataByMonth,
  bookingId: string,
  toRoomId: string | null,
): CalendarDataByMonth {
  let changed = false;
  const next: CalendarDataByMonth = {};
  for (const [ym, payload] of Object.entries(dataByMonth)) {
    if (findBooking(payload, bookingId)) {
      next[ym] = applyOptimisticBookingMove(payload, bookingId, toRoomId);
      changed = true;
    } else {
      next[ym] = payload;
    }
  }
  return changed ? next : dataByMonth;
}

/**
 * Put back only this booking's copies after a refused move. A copy that no longer shows the
 * optimistic room (a newer move or a reload replaced it) is left alone.
 */
export function restoreBookingInMonths(
  dataByMonth: CalendarDataByMonth,
  bookingId: string,
  snapshot: BookingItemSnapshot,
  optimisticRoomId: string | null,
): CalendarDataByMonth {
  let changed = false;
  const next: CalendarDataByMonth = {};
  for (const [ym, payload] of Object.entries(dataByMonth)) {
    const saved = snapshot[ym];
    const current = findBooking(payload, bookingId);
    if (!saved || !current || current.roomId !== optimisticRoomId) {
      next[ym] = payload;
      continue;
    }
    changed = true;
    next[ym] = {
      ...payload,
      items: payload.items.map((item) =>
        item.kind === "booking" && item.id === bookingId ? structuredClone(saved) : item,
      ),
    };
  }
  return changed ? next : dataByMonth;
}

export type ConfirmedAssignment = { id: string; roomId: string; version: number } | null;

/**
 * Write the assignment the server confirmed into every copy of the booking, so an immediate
 * second move sends the new version instead of the stale one.
 */
export function applyConfirmedAssignmentToMonths(
  dataByMonth: CalendarDataByMonth,
  bookingId: string,
  assignment: ConfirmedAssignment,
): CalendarDataByMonth {
  let changed = false;
  const next: CalendarDataByMonth = {};
  for (const [ym, payload] of Object.entries(dataByMonth)) {
    if (!findBooking(payload, bookingId)) {
      next[ym] = payload;
      continue;
    }
    changed = true;
    const moved = applyOptimisticBookingMove(payload, bookingId, assignment?.roomId ?? null);
    next[ym] = {
      ...moved,
      items: moved.items.map((item) =>
        item.kind === "booking" && item.id === bookingId
          ? {
              ...item,
              assignmentId: assignment?.id ?? null,
              assignmentVersion: assignment?.version ?? null,
            }
          : item,
      ),
    };
  }
  return changed ? next : dataByMonth;
}

export type BookingDragPayload = {
  type: "booking";
  bookingId: string;
  assignmentId: string | null;
  assignmentVersion: number | null;
  fromRoomId: string | null;
};

export function bookingItemToDragPayload(item: CalendarBookingItem): BookingDragPayload {
  return {
    type: "booking",
    bookingId: item.id,
    assignmentId: item.assignmentId,
    assignmentVersion: item.assignmentVersion,
    fromRoomId: item.roomId,
  };
}

export function parseLaneDropTarget(overId: string): "unassigned" | string | null {
  if (overId === "lane-unassigned") return "unassigned";
  const prefix = "lane-room-";
  if (overId.startsWith(prefix)) return overId.slice(prefix.length);
  return null;
}

export { formatAllocationError } from "./allocationErrors";

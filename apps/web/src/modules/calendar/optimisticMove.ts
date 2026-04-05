import type { CalendarMonthPayload } from "./calendarTypes";

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

export type BookingDragPayload = {
  type: "booking";
  bookingId: string;
  assignmentId: string | null;
  assignmentVersion: number | null;
  fromRoomId: string | null;
};

export function parseLaneDropTarget(overId: string): "unassigned" | string | null {
  if (overId === "lane-unassigned") return "unassigned";
  const prefix = "lane-room-";
  if (overId.startsWith(prefix)) return overId.slice(prefix.length);
  return null;
}

export function formatAllocationError(code: string | undefined, message: string): string {
  if (code === "CONFLICT_ASSIGNMENT") return "That room is already booked for those nights.";
  if (code === "CONFLICT_BLOCK") return "That room is blocked for maintenance.";
  if (code === "ROOM_INACTIVE") return "That room is not active.";
  return message;
}

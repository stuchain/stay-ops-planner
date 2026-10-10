import type { CalendarRoom } from "./calendarTypes";

/** Apartment row title; a switched-off apartment (shown only while it has stays) says so. */
export function roomLaneTitle(room: Pick<CalendarRoom, "id" | "code" | "name" | "isActive">): string {
  const name = room.name || room.code || room.id;
  return room.isActive ? name : `${name} · Απενεργοποιημένο`;
}

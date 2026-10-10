import { parseLaneDropTarget } from "./optimisticMove";

/** Strip an optional "<scope>:" prefix (e.g. "2026-10:lane-room-x" -> "lane-room-x"). */
function stripScope(overId: string): string {
  if (overId.startsWith("room-order:")) return overId;
  const i = overId.indexOf(":");
  return i < 0 ? overId : overId.slice(i + 1);
}

/**
 * Maps a dnd-kit "over" id to a booking drop target.
 * Returns "unassigned", a room id, or null when the id is not a lane/row target.
 * A reorder row (`room-order:<id>`, optionally scoped) counts as a drop on that room.
 */
export function bookingDropTargetFromOverId(overId: string): "unassigned" | string | null {
  const id = stripScope(overId);
  if (id.startsWith("room-order:")) {
    const roomId = id.slice("room-order:".length);
    return roomId ? roomId : null;
  }
  return parseLaneDropTarget(id);
}

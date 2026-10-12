import { prisma } from "@/lib/prisma";
import { EDITABLE_FIELDS, type EditableField } from "./bookingEdit";

type Dict = Record<string, unknown>;

/** One change, described by data. The client turns it into a sentence in the person's language. */
export type HistoryEvent =
  | { kind: "moved"; from: string | null; to: string | null }
  | { kind: "edited"; fields: EditableField[] }
  | { kind: "reset"; field: EditableField }
  | { kind: "guestNote" }
  | { kind: "created" }
  | { kind: "synced" }
  | { kind: "datesFollowed" }
  | { kind: "movedOutBySync" }
  | { kind: "cancelled" }
  /** Anything else: a plain "something changed" sentence, never the code. */
  | { kind: "other" };

export type HistoryEntry = {
  id: string;
  /** ISO time of the change. */
  at: string;
  event: HistoryEvent;
};

const LIMIT = 10;

function dict(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

function fieldsOf(value: unknown): EditableField[] {
  const list = Array.isArray(value) ? value : [];
  return list.filter((f): f is EditableField => (EDITABLE_FIELDS as readonly string[]).includes(f as string));
}

/** The last changes to one booking, newest first. */
export async function bookingHistory(bookingId: string): Promise<HistoryEntry[]> {
  const rows = await prisma.auditEvent.findMany({
    where: {
      OR: [
        { entityType: "booking", entityId: bookingId },
        { entityType: "assignment", metaJson: { path: ["bookingId"], equals: bookingId } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
  });

  const roomIds = new Set<string>();
  for (const r of rows) {
    if (r.action !== "booking.move") continue;
    for (const side of [dict(r.beforeJson), dict(r.afterJson)]) {
      if (typeof side.roomId === "string") roomIds.add(side.roomId);
    }
  }
  const rooms = roomIds.size
    ? await prisma.room.findMany({
        where: { id: { in: [...roomIds] } },
        select: { id: true, displayName: true, code: true },
      })
    : [];
  const roomName = (id: unknown): string | null => {
    if (typeof id !== "string") return null;
    const room = rooms.find((r) => r.id === id);
    return room ? (room.displayName ?? room.code ?? null) : null;
  };

  return rows.map((r): HistoryEntry => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    event: describeAuditEvent(r, roomName),
  }));
}

/** What one audit row means for a booking, by data. Anything unknown is `other`. */
export function describeAuditEvent(
  r: { action: string; beforeJson: unknown; afterJson: unknown; metaJson: unknown },
  roomName: (id: unknown) => string | null,
): HistoryEvent {
  const before = dict(r.beforeJson);
  const after = dict(r.afterJson);
  const meta = dict(r.metaJson);
  switch (r.action) {
    case "booking.move":
      return { kind: "moved", from: roomName(before.roomId), to: roomName(after.roomId) };
    case "booking.details_edit":
      return { kind: "edited", fields: fieldsOf(meta.fields) };
    case "booking.field_reset": {
      const [field] = fieldsOf(meta.fields);
      return field ? { kind: "reset", field } : { kind: "other" };
    }
    case "booking.guest_note":
      return { kind: "guestNote" };
    case "booking.sync_upsert":
      if (r.beforeJson === null) return { kind: "created" };
      return after.status === "cancelled" ? { kind: "cancelled" } : { kind: "synced" };
    case "assignment.dates_followed_sync":
      return { kind: "datesFollowed" };
    case "assignment.cleared_on_sync_revalidation":
      return { kind: "movedOutBySync" };
    default:
      return { kind: "other" };
  }
}

import { prisma } from "@/lib/prisma";
import { EDITABLE_FIELDS, type EditableField } from "./bookingEdit";

type Dict = Record<string, unknown>;

/** One change, described by data. The client turns it into a sentence in the person's language. */
export type HistoryEntry = {
  id: string;
  /** ISO time of the change. */
  at: string;
  event:
    | { kind: "moved"; from: string | null; to: string | null }
    | { kind: "edited"; fields: EditableField[] }
    | { kind: "reset"; field: EditableField }
    | { kind: "created" }
    | { kind: "synced" }
    | { kind: "datesFollowed" }
    | { kind: "movedOutBySync" }
    | { kind: "cancelled" }
    /** Anything else: a plain "something changed" sentence, never the code. */
    | { kind: "other" };
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

  return rows.map((r): HistoryEntry => {
    const base = { id: r.id, at: r.createdAt.toISOString() };
    const before = dict(r.beforeJson);
    const after = dict(r.afterJson);
    const meta = dict(r.metaJson);
    switch (r.action) {
      case "booking.move":
        return { ...base, event: { kind: "moved", from: roomName(before.roomId), to: roomName(after.roomId) } };
      case "booking.details_edit":
        return { ...base, event: { kind: "edited", fields: fieldsOf(meta.fields) } };
      case "booking.field_reset": {
        const [field] = fieldsOf(meta.fields);
        return { ...base, event: field ? { kind: "reset", field } : { kind: "other" } };
      }
      case "booking.sync_upsert":
        if (r.beforeJson === null) return { ...base, event: { kind: "created" } };
        return { ...base, event: after.status === "cancelled" ? { kind: "cancelled" } : { kind: "synced" } };
      case "assignment.dates_followed_sync":
        return { ...base, event: { kind: "datesFollowed" } };
      case "assignment.cleared_on_sync_revalidation":
        return { ...base, event: { kind: "movedOutBySync" } };
      default:
        return { ...base, event: { kind: "other" } };
    }
  });
}

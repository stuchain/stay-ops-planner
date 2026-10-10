import { writeAuditSnapshot } from "@stay-ops/audit";
import { BookingStatus } from "@stay-ops/db";
import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { isoToDbDate, todayIso } from "@/server/time";

/** One row of the Dev mode Apartments table. */
export type ApartmentRow = {
  id: string;
  name: string;
  color: string | null;
  capacity: number | null;
  preferredForLargeParty: boolean;
  isActive: boolean;
  /** The Hosthub rental this apartment receives bookings for (rooms.code), and its title when known. */
  rental: { id: string; title: string | null } | null;
  /** Created by a sync and never set up: inactive, no capacity or colour yet. */
  needsSetup: boolean;
  /** Placed bookings that have not ended. */
  upcomingBookings: number;
};

const ORDER = [
  { calendarSortIndex: { sort: "asc" as const, nulls: "last" as const } },
  { displayName: "asc" as const },
  { id: "asc" as const },
];

const FUTURE_STATUSES = [BookingStatus.confirmed, BookingStatus.needs_reassignment, BookingStatus.pending];

async function upcomingByRoom(today: Date): Promise<Map<string, number>> {
  const rows = await prisma.assignment.groupBy({
    by: ["roomId"],
    where: { booking: { checkoutDate: { gt: today }, status: { in: FUTURE_STATUSES } } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.roomId, r._count._all]));
}

/** Every apartment in calendar order, inactive ones included. */
export async function listApartments(now = new Date()): Promise<ApartmentRow[]> {
  const today = isoToDbDate(todayIso(now));
  const [rooms, upcoming, listings] = await Promise.all([
    prisma.room.findMany({ orderBy: ORDER }),
    upcomingByRoom(today),
    prisma.sourceListing.findMany({ select: { externalListingId: true, title: true } }),
  ]);
  const titles = new Map(listings.map((l) => [l.externalListingId, l.title]));
  return rooms.map((r) => ({
    id: r.id,
    name: r.displayName ?? r.code ?? r.id,
    color: r.color,
    capacity: r.maxGuests,
    preferredForLargeParty: r.preferredForLargeParty,
    isActive: r.isActive,
    rental: r.code ? { id: r.code, title: titles.get(r.code) ?? null } : null,
    needsSetup: !r.isActive && r.maxGuests === null && r.color === null,
    upcomingBookings: upcoming.get(r.id) ?? 0,
  }));
}

export type ApartmentPatch = {
  name?: string | undefined;
  color?: string | null | undefined;
  capacity?: number | null | undefined;
  preferredForLargeParty?: boolean | undefined;
  isActive?: boolean | undefined;
};

/** Changes one apartment. Taking an apartment out of use is refused while bookings are still placed in it. */
export async function updateApartment(
  input: { id: string; patch: ApartmentPatch; actorUserId: string },
  now = new Date(),
): Promise<ApartmentRow> {
  const { id, patch, actorUserId } = input;
  await prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id } });
    if (!room) throw new DomainError("NOT_FOUND");
    if (patch.isActive === false && room.isActive) {
      const count = await tx.assignment.count({
        where: {
          roomId: id,
          booking: { checkoutDate: { gt: isoToDbDate(todayIso(now)) }, status: { in: FUTURE_STATUSES } },
        },
      });
      if (count > 0) throw new DomainError("ROOM_HAS_BOOKINGS", { count });
    }
    const data = {
      ...(patch.name !== undefined ? { displayName: patch.name } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.capacity !== undefined ? { maxGuests: patch.capacity } : {}),
      ...(patch.preferredForLargeParty !== undefined ? { preferredForLargeParty: patch.preferredForLargeParty } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    };
    const updated = await tx.room.update({ where: { id }, data });
    await writeAuditSnapshot(tx, {
      actorUserId,
      entityType: "room",
      entityId: id,
      action: "room.update",
      before: {
        displayName: room.displayName,
        color: room.color,
        maxGuests: room.maxGuests,
        preferredForLargeParty: room.preferredForLargeParty,
        isActive: room.isActive,
      },
      after: {
        displayName: updated.displayName,
        color: updated.color,
        maxGuests: updated.maxGuests,
        preferredForLargeParty: updated.preferredForLargeParty,
        isActive: updated.isActive,
      },
    });
  });
  const row = (await listApartments(now)).find((r) => r.id === id);
  if (!row) throw new DomainError("NOT_FOUND");
  return row;
}

/** Sets the calendar order to `ids` (every apartment, first to last). */
export async function reorderApartments(input: { ids: string[]; actorUserId: string }): Promise<void> {
  const { ids, actorUserId } = input;
  if (new Set(ids).size !== ids.length) throw new DomainError("VALIDATION");
  await prisma.$transaction(async (tx) => {
    const rooms = await tx.room.findMany({ orderBy: ORDER, select: { id: true } });
    const known = new Set(rooms.map((r) => r.id));
    if (ids.length !== rooms.length || ids.some((id) => !known.has(id))) throw new DomainError("CHANGED_MEANWHILE");
    for (const [index, id] of ids.entries()) {
      await tx.room.update({ where: { id }, data: { calendarSortIndex: index } });
    }
    await writeAuditSnapshot(tx, {
      actorUserId,
      entityType: "room",
      entityId: "order",
      action: "room.reorder",
      before: { ids: rooms.map((r) => r.id) },
      after: { ids },
    });
  });
}

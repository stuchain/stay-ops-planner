import { writeAuditSnapshot } from "@stay-ops/audit";
import {
  BookingStatus,
  cancelOpenTurnoverTasks,
  ensureTurnoverCleaningTask,
  findStayConflict,
  Prisma,
} from "@stay-ops/db";
import { DomainError, partySize, placeNights, samePieces, type IsoDate, type StayPiece } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { dbDateToIso, isoToDbDate, todayIso } from "@/server/time";
import { bookingSliceSelect, partyOf, toBookingSlice, type BookingSlice } from "./bookingSlice";
import { toPieces } from "./stayPieces";

export type MoveBookingInput = {
  bookingId: string;
  /** The apartment to place the booking in, or null to take it out ("needs an apartment"). */
  roomId: string | null;
  /**
   * Only these nights `[from, to)` go to the apartment; the other nights keep theirs. This is how a guest who moved
   * apartment mid-stay is split. Leave both out to move the whole stay.
   */
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
  /** The booking `version` the person was looking at. */
  expectedVersion: number;
  /** The guest has already arrived and the person said yes to moving them (E1-1). */
  confirmStarted?: boolean | undefined;
  actorUserId: string;
};

export type MoveWarning = "OVER_CAPACITY";

export type MoveBookingResult = { booking: BookingSlice; warnings: MoveWarning[] };

const PLACEABLE: BookingStatus[] = [BookingStatus.confirmed, BookingStatus.needs_reassignment];

function roomName(room: { displayName: string | null; code: string | null; id: string }): string {
  return room.displayName ?? room.code ?? room.id;
}

/** The guest named in a ROOM_TAKEN error, read inside the same transaction. */
async function guestInAssignment(tx: Prisma.TransactionClient, assignmentId: string): Promise<string> {
  const row = await tx.assignment.findUnique({
    where: { id: assignmentId },
    select: { booking: { select: { guestName: true } } },
  });
  return row?.booking.guestName ?? "άλλη κράτηση";
}

/**
 * Saves the booking's apartments as `target`. A piece that keeps its apartment and nights keeps its row (and its
 * id in the history); the others are replaced. Removed rows go first, so the no-overlap rules never see both.
 */
async function writePieces(
  tx: Prisma.TransactionClient,
  bookingId: string,
  rows: readonly { id: string; roomId: string; startDate: Date; endDate: Date }[],
  target: readonly StayPiece[],
  actorUserId: string | null,
): Promise<void> {
  const same = (r: (typeof rows)[number], p: StayPiece) =>
    r.roomId === p.roomId && dbDateToIso(r.startDate) === p.start && dbDateToIso(r.endDate) === p.end;
  const stale = rows.filter((r) => !target.some((p) => same(r, p)));
  const fresh = target.filter((p) => !rows.some((r) => same(r, p)));
  if (stale.length > 0) await tx.assignment.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
  for (const p of fresh) {
    await tx.assignment.create({
      data: {
        bookingId,
        roomId: p.roomId,
        startDate: isoToDbDate(p.start),
        endDate: isoToDbDate(p.end),
        pinned: true,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
  }
  // A move pins every piece, including the ones that stayed, so the auto-planner leaves the whole stay alone.
  await tx.assignment.updateMany({
    where: { bookingId, pinned: false },
    data: { pinned: true, updatedById: actorUserId },
  });
}

async function moveInTransaction(
  tx: Prisma.TransactionClient,
  input: MoveBookingInput,
  today: IsoDate,
): Promise<MoveBookingResult> {
  await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${input.bookingId} FOR UPDATE`;
  const booking = await tx.booking.findUnique({
    where: { id: input.bookingId },
    include: {
      assignments: {
        orderBy: { startDate: "asc" },
        include: { room: { select: { id: true, code: true, displayName: true } } },
      },
    },
  });
  if (!booking) throw new DomainError("NOT_FOUND");

  const checkin = dbDateToIso(booking.checkinDate);
  const checkout = dbDateToIso(booking.checkoutDate);
  const rows = booking.assignments;
  const current = toPieces(rows);
  const arrival = rows[0] ?? null;
  const warnings: MoveWarning[] = [];

  const from = input.from ?? checkin;
  const to = input.to ?? checkout;
  const partial = from !== checkin || to !== checkout;
  if (!(checkin <= from && from < to && to <= checkout)) throw new DomainError("VALIDATION");
  // Part of a stay can only move once the whole stay has an apartment, and cannot be taken out on its own.
  if (partial && (input.roomId === null || current.length === 0)) throw new DomainError("VALIDATION");
  const target: StayPiece[] = input.roomId === null ? [] : placeNights(current, from, to, input.roomId);

  // Nothing to do: already where it was asked to go. Checked before the version, so a move that went through
  // but whose answer was lost succeeds when it is sent again instead of saying the booking changed (E2-7).
  if (samePieces(current, target)) {
    const slice = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: bookingSliceSelect });
    return { booking: toBookingSlice(slice), warnings };
  }

  if (booking.version !== input.expectedVersion) throw new DomainError("BOOKING_CHANGED");
  if (!PLACEABLE.includes(booking.status)) throw new DomainError("NOT_CONFIRMED");

  // A finished stay keeps its apartment. One that never had one can still be given the apartment the guest
  // stayed in, so the past calendar and the income per apartment are complete.
  const ended = checkout <= today;
  if (ended && (arrival || input.roomId === null)) throw new DomainError("STAY_ENDED");
  if (arrival && checkin <= today && !input.confirmStarted) {
    throw new DomainError("STAY_STARTED", { guestName: booking.guestName ?? "", roomName: roomName(arrival.room) });
  }

  const actorUserId =
    (await tx.user.findUnique({ where: { id: input.actorUserId }, select: { id: true } }))?.id ?? null;
  let afterRoomId: string | null = null;

  if (input.roomId === null) {
    // Take it out of its apartment(s); it goes back to "needs an apartment".
    // A finished cleaning stays; only the open ones are cancelled (E4-4).
    await cancelOpenTurnoverTasks(tx, booking.id);
    await tx.assignment.deleteMany({ where: { bookingId: booking.id } });
  } else {
    const room = await tx.room.findUnique({
      where: { id: input.roomId },
      select: { id: true, isActive: true, maxGuests: true },
    });
    if (!room) throw new DomainError("NOT_FOUND");
    if (!room.isActive) throw new DomainError("ROOM_INACTIVE");

    const conflict = await findStayConflict(tx, {
      roomId: room.id,
      start: isoToDbDate(from),
      end: isoToDbDate(to),
      excludeBookingId: booking.id,
    });
    if (conflict?.kind === "assignment") {
      throw new DomainError("ROOM_TAKEN", { guestName: await guestInAssignment(tx, conflict.id) });
    }
    if (conflict) throw new DomainError("ROOM_CLOSED");

    await writePieces(tx, booking.id, rows, target, actorUserId);
    if (!ended) {
      const last = target[target.length - 1]!;
      await ensureTurnoverCleaningTask(tx, {
        bookingId: booking.id,
        roomId: last.roomId,
        checkoutDate: booking.checkoutDate,
      });
    }

    const party = partyOf(booking);
    if (party !== null && room.maxGuests !== null && partySize(party) > room.maxGuests) warnings.push("OVER_CAPACITY");
    afterRoomId = target[0]!.roomId;
  }

  const updated = await tx.booking.update({
    where: { id: booking.id },
    data: {
      version: { increment: 1 },
      // Placed again, so the "needs a new apartment" flag is done.
      ...(afterRoomId !== null && booking.status === BookingStatus.needs_reassignment
        ? { status: BookingStatus.confirmed }
        : {}),
    },
    select: bookingSliceSelect,
  });

  await writeAuditSnapshot(tx, {
    actorUserId,
    action: "booking.move",
    entityType: "booking",
    entityId: booking.id,
    before: { roomId: arrival?.roomId ?? null, pieces: current, version: booking.version },
    after: { roomId: afterRoomId, pieces: target, version: updated.version },
    meta: { warnings, confirmStarted: Boolean(input.confirmStarted), ...(partial ? { from, to } : {}) },
  });

  return { booking: toBookingSlice(updated), warnings };
}

/** Postgres errors from two moves racing each other, turned into what the person should hear (E1-3). */
function mapRaceError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2034") throw new DomainError("BOOKING_CHANGED");
    if (err.code === "P2002") throw new DomainError("BOOKING_CHANGED");
  }
  const text = err instanceof Error ? err.message : "";
  if (text.includes("23P01") || text.includes("_stay_excl"))
    throw new DomainError("ROOM_TAKEN", { guestName: "άλλη κράτηση" });
  if (text.includes("40001") || text.includes("could not serialize")) throw new DomainError("BOOKING_CHANGED");
  throw err;
}

/**
 * Place a booking in an apartment, move it to another one, or take it out, in one serializable
 * transaction with the audit row and the turnover cleaning task. Moving a guest who has already
 * arrived needs `confirmStarted`; a stay that is over cannot move. A party bigger than the
 * apartment is allowed and comes back as an OVER_CAPACITY warning (E1-2).
 */
export async function moveBooking(input: MoveBookingInput, now = new Date()): Promise<MoveBookingResult> {
  const today = todayIso(now);
  try {
    return await prisma.$transaction((tx) => moveInTransaction(tx, input, today), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (err) {
    if (err instanceof DomainError) throw err;
    mapRaceError(err);
  }
}

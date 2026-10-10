import { writeAuditSnapshot } from "@stay-ops/audit";
import { BookingStatus, ensureTurnoverCleaningTask, findStayConflict, Prisma } from "@stay-ops/db";
import {
  addDays,
  DomainError,
  isIsoDate,
  planAssignments,
  type BookingToPlace,
  type IsoDate,
  type PinnedPlacement,
  type ReasonCode,
} from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { dbDateToIso, isoToDbDate, todayIso } from "@/server/time";
import { bookingSliceSelect, partyOf, toBookingSlice } from "./bookingSlice";
import { listCalendarRooms } from "./calendarRange";
import { loadRecommenderConfig } from "./recommenderConfig";
import { loadTimelines } from "./roomTimelines";

/** A booking the planner put in an apartment, as shown in the preview. */
export type ArrangePlacement = {
  bookingId: string;
  /** Send back on apply: the plan is refused if the booking changed since the preview. */
  version: number;
  guestName: string | null;
  checkin: IsoDate;
  checkout: IsoDate;
  partySize: number | null;
  roomId: string;
  reasons: ReasonCode[];
  warnings: "OVER_CAPACITY"[];
};

/** A booking that fits in no apartment around what is already placed. */
export type ArrangeUnplaced = {
  bookingId: string;
  guestName: string | null;
  checkin: IsoDate;
  checkout: IsoDate;
  partySize: number | null;
};

export type ArrangeProposal = {
  /** First day of the month, `YYYY-MM-01`. */
  month: IsoDate;
  placements: ArrangePlacement[];
  unplaced: ArrangeUnplaced[];
};

const PLACEABLE: BookingStatus[] = [BookingStatus.confirmed, BookingStatus.needs_reassignment];

/** `YYYY-MM` (or any date in the month) to the month's first day and the next month's first day. */
export function monthBounds(month: string): { start: IsoDate; end: IsoDate } {
  const first = `${month.slice(0, 7)}-01`;
  if (!isIsoDate(first)) throw new DomainError("VALIDATION");
  const [y, m] = [Number(first.slice(0, 4)), Number(first.slice(5, 7))];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: first as IsoDate, end: next as IsoDate };
}

/**
 * What "Τακτοποίησε τον μήνα" would do: every confirmed booking in the month that still needs an apartment,
 * placed with the planner around everything already placed and every closed period. Nothing already in an
 * apartment moves (pinned or not), and stays that are over are left out.
 */
export async function proposeArrangement(month: string, now = new Date()): Promise<ArrangeProposal> {
  const { start, end } = monthBounds(month);
  const today = todayIso(now);
  const from = start > today ? start : today;

  const candidates =
    from >= end
      ? []
      : await prisma.booking.findMany({
          where: {
            status: { in: PLACEABLE },
            assignment: null,
            checkinDate: { lt: isoToDbDate(end) },
            checkoutDate: { gt: isoToDbDate(from) },
          },
          select: bookingSliceSelect,
          orderBy: [{ checkinDate: "asc" }, { id: "asc" }],
        });
  if (candidates.length === 0) return { month: start, placements: [], unplaced: [] };

  const slices = candidates.map(toBookingSlice);
  // The window covers every candidate's whole stay plus a night either side (for the single-night-gap rule).
  const windowStart = isoToDbDate(
    addDays(
      slices.reduce((a, s) => (s.checkin < a ? s.checkin : a), slices[0]!.checkin),
      -1,
    ),
  );
  const windowEnd = isoToDbDate(
    addDays(
      slices.reduce((a, s) => (s.checkout > a ? s.checkout : a), slices[0]!.checkout),
      1,
    ),
  );

  const [rooms, timelines, config] = await Promise.all([
    listCalendarRooms(),
    loadTimelines(windowStart, windowEnd),
    loadRecommenderConfig(),
  ]);
  const pinned: PinnedPlacement[] = [...timelines].flatMap(([roomId, occupants]) =>
    occupants.map((occupant) => ({ roomId, occupant })),
  );

  const toPlace: BookingToPlace[] = candidates.map((row) => ({
    id: row.id,
    stay: { checkin: dbDateToIso(row.checkinDate), checkout: dbDateToIso(row.checkoutDate) },
    party: partyOf(row),
  }));
  const plan = planAssignments(
    toPlace,
    rooms.map((r, index) => ({
      id: r.id,
      sortOrder: index,
      capacity: r.capacity,
      preferredForLargeParty: r.preferredForLargeParty,
      isActive: r.isActive,
    })),
    pinned,
    config,
  );

  const placements: ArrangePlacement[] = [];
  const unplaced: ArrangeUnplaced[] = [];
  for (const s of slices) {
    const pick = plan.picks.get(s.id);
    const base = { guestName: s.guestName, checkin: s.checkin, checkout: s.checkout, partySize: s.partySize };
    if (pick) {
      placements.push({
        bookingId: s.id,
        version: s.version,
        ...base,
        roomId: pick.roomId,
        reasons: [...pick.reasons],
        warnings: [...pick.warnings],
      });
    } else {
      unplaced.push({ bookingId: s.id, ...base });
    }
  }
  return { month: start, placements, unplaced };
}

export type ApplyArrangementInput = {
  placements: { bookingId: string; roomId: string; expectedVersion: number }[];
  actorUserId: string;
};

async function applyInTransaction(
  tx: Prisma.TransactionClient,
  input: ApplyArrangementInput,
  today: IsoDate,
): Promise<number> {
  const actorUserId =
    (await tx.user.findUnique({ where: { id: input.actorUserId }, select: { id: true } }))?.id ?? null;
  // Lock in a fixed order so two people applying at once cannot deadlock.
  const ordered = [...input.placements].sort((a, b) => (a.bookingId < b.bookingId ? -1 : 1));
  for (const p of ordered) await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${p.bookingId} FOR UPDATE`;

  for (const p of input.placements) {
    const booking = await tx.booking.findUnique({
      where: { id: p.bookingId },
      select: { id: true, version: true, status: true, checkinDate: true, checkoutDate: true, assignment: true },
    });
    // Anything different from the preview means the plan is out of date: nothing is saved.
    if (!booking || booking.version !== p.expectedVersion || booking.assignment !== null)
      throw new DomainError("CHANGED_MEANWHILE");
    if (!PLACEABLE.includes(booking.status)) throw new DomainError("CHANGED_MEANWHILE");
    if (dbDateToIso(booking.checkoutDate) <= today) throw new DomainError("CHANGED_MEANWHILE");

    const room = await tx.room.findUnique({ where: { id: p.roomId }, select: { id: true, isActive: true } });
    if (!room || !room.isActive) throw new DomainError("CHANGED_MEANWHILE");
    const conflict = await findStayConflict(tx, {
      roomId: room.id,
      start: booking.checkinDate,
      end: booking.checkoutDate,
      excludeAssignmentId: null,
    });
    if (conflict) throw new DomainError("CHANGED_MEANWHILE");

    await tx.assignment.create({
      data: {
        bookingId: booking.id,
        roomId: room.id,
        startDate: booking.checkinDate,
        endDate: booking.checkoutDate,
        // Placed by the planner, not by hand.
        pinned: false,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
    await ensureTurnoverCleaningTask(tx, {
      bookingId: booking.id,
      roomId: room.id,
      checkoutDate: booking.checkoutDate,
    });
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: {
        version: { increment: 1 },
        ...(booking.status === BookingStatus.needs_reassignment ? { status: BookingStatus.confirmed } : {}),
      },
      select: { version: true },
    });
    await writeAuditSnapshot(tx, {
      actorUserId,
      action: "booking.arrange",
      entityType: "booking",
      entityId: booking.id,
      before: { roomId: null, version: booking.version },
      after: { roomId: room.id, version: updated.version },
      meta: { batchSize: input.placements.length },
    });
  }
  return input.placements.length;
}

/**
 * Apply the preview exactly as shown, all or nothing, in one serializable transaction. Each booking gets the
 * same checks as a single move; if any booking or apartment changed since the preview, nothing is saved.
 */
export async function applyArrangement(input: ApplyArrangementInput, now = new Date()): Promise<{ placed: number }> {
  const ids = new Set(input.placements.map((p) => p.bookingId));
  if (ids.size !== input.placements.length) throw new DomainError("VALIDATION");
  if (input.placements.length === 0) return { placed: 0 };
  const today = todayIso(now);
  try {
    const placed = await prisma.$transaction((tx) => applyInTransaction(tx, input, today), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20_000,
    });
    return { placed };
  } catch (err) {
    if (err instanceof DomainError) throw err;
    const text = err instanceof Error ? err.message : "";
    if (
      (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2002")) ||
      text.includes("23P01") ||
      text.includes("_stay_excl") ||
      text.includes("40001") ||
      text.includes("could not serialize")
    )
      throw new DomainError("CHANGED_MEANWHILE");
    throw err;
  }
}

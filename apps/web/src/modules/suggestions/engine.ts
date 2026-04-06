import { BookingStatus, PrismaClient, TURNOVER_MINUTES } from "@stay-ops/db";

export const SUGGESTION_ENGINE_VERSION = 1;

const AVAILABILITY_WEIGHT = 60;
const CLEANING_FIT_WEIGHT = 30;
const TIE_BREAKER_WEIGHT = 10;

const prisma = new PrismaClient();

type SuggestionContext = {
  bookingId: string;
  checkinDate: Date;
  checkoutDate: Date;
};

type RoomCandidate = {
  id: string;
  code: string | null;
};

type BookingWindowSnapshot = {
  checkinDate: Date;
  checkoutDate: Date;
};

type RoomTimelineSnapshot = {
  roomId: string;
  assignments: BookingWindowSnapshot[];
  blocks: BookingWindowSnapshot[];
};

export type RankedSuggestion = {
  roomId: string;
  score: number;
};

function sortRoomsDeterministically(rooms: RoomCandidate[]): RoomCandidate[] {
  return rooms.slice().sort((a, b) => {
    const aCode = (a.code ?? "").toLowerCase();
    const bCode = (b.code ?? "").toLowerCase();
    if (aCode !== bCode) return aCode.localeCompare(bCode);
    return a.id.localeCompare(b.id);
  });
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function hasAvailabilityConflict(timeline: RoomTimelineSnapshot, ctx: SuggestionContext): boolean {
  return (
    timeline.assignments.some((row) => overlaps(row.checkinDate, row.checkoutDate, ctx.checkinDate, ctx.checkoutDate)) ||
    timeline.blocks.some((row) => overlaps(row.checkinDate, row.checkoutDate, ctx.checkinDate, ctx.checkoutDate))
  );
}

function latestCheckoutBefore(
  timeline: RoomTimelineSnapshot,
  date: Date,
): Date | null {
  let latest: Date | null = null;
  for (const row of timeline.assignments) {
    if (row.checkoutDate <= date && (!latest || row.checkoutDate > latest)) {
      latest = row.checkoutDate;
    }
  }
  return latest;
}

function hasCleaningFit(timeline: RoomTimelineSnapshot, ctx: SuggestionContext): boolean {
  const previousCheckout = latestCheckoutBefore(timeline, ctx.checkinDate);
  if (!previousCheckout) return true;
  const gapMinutes = (ctx.checkinDate.getTime() - previousCheckout.getTime()) / 60_000;
  return gapMinutes >= TURNOVER_MINUTES;
}

function tieBreakerBonus(index: number, total: number): number {
  if (total <= 1) return TIE_BREAKER_WEIGHT;
  const fraction = (total - index) / total;
  return Number((fraction * TIE_BREAKER_WEIGHT).toFixed(2));
}

function scoreRoom(
  timeline: RoomTimelineSnapshot,
  ctx: SuggestionContext,
  index: number,
  total: number,
): number {
  const availability = hasAvailabilityConflict(timeline, ctx) ? 0 : AVAILABILITY_WEIGHT;
  const cleaningFit = hasCleaningFit(timeline, ctx) ? CLEANING_FIT_WEIGHT : 0;
  const tieBreaker = tieBreakerBonus(index, total);
  return Number((availability + cleaningFit + tieBreaker).toFixed(2));
}

async function loadContext(bookingId: string): Promise<SuggestionContext | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      checkinDate: true,
      checkoutDate: true,
      assignment: { select: { id: true } },
    },
  });
  if (!booking) return null;
  if (booking.status !== BookingStatus.confirmed && booking.status !== BookingStatus.needs_reassignment) {
    return null;
  }
  if (booking.assignment) return null;
  return {
    bookingId: booking.id,
    checkinDate: booking.checkinDate,
    checkoutDate: booking.checkoutDate,
  };
}

async function loadRoomSnapshots(): Promise<RoomTimelineSnapshot[]> {
  const rooms = await prisma.room.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      assignments: { select: { startDate: true, endDate: true } },
      manualBlocks: { select: { startDate: true, endDate: true } },
    },
  });

  const ordered = sortRoomsDeterministically(rooms);
  return ordered.map((room) => ({
    roomId: room.id,
    assignments: room.assignments.map((row) => ({
      checkinDate: row.startDate,
      checkoutDate: row.endDate,
    })),
    blocks: room.manualBlocks.map((row) => ({
      checkinDate: row.startDate,
      checkoutDate: row.endDate,
    })),
  }));
}

export async function rankBookingSuggestions(bookingId: string): Promise<RankedSuggestion[]> {
  const ctx = await loadContext(bookingId);
  if (!ctx) return [];

  const snapshots = await loadRoomSnapshots();
  return snapshots
    .map((snapshot, index) => ({
      roomId: snapshot.roomId,
      score: scoreRoom(snapshot, ctx, index, snapshots.length),
    }))
    .sort((a, b) => b.score - a.score || a.roomId.localeCompare(b.roomId));
}

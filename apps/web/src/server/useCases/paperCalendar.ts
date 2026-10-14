import { writeAuditSnapshot } from "@stay-ops/audit";
import { BookingStatus, ensureTurnoverCleaningTask, Prisma, type Channel } from "@stay-ops/db";
import {
  DomainError,
  fitPiecesToStay,
  matchPaperStays,
  normalizePieces,
  paperStays,
  samePieces,
  type IsoDate,
  type PaperMatchKind,
  type StayPiece,
} from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { CalendarSheetError, PAPER_APARTMENTS, readCalendarSheet } from "@/server/paperCalendar/readCalendarSheet";
import { dbDateToIso, isoToDbDate, todayIso } from "@/server/time";
import { toPieces } from "./stayPieces";

/**
 * Fills in where past guests stayed from the family's Excel calendar: first a preview of what would change, then
 * saving the stays the person ticked. Only stays that have already started; from today on the app is the calendar.
 */

export type PaperPiece = StayPiece & { readonly roomName: string };

export type PaperItemState = "new" | "change" | "same" | "missing";

export type PaperItem = {
  readonly paperName: string;
  readonly guests: number | null;
  readonly paperStart: IsoDate;
  readonly paperEnd: IsoDate;
  readonly paperPieces: readonly PaperPiece[];
  readonly booking: {
    readonly id: string;
    readonly guestName: string | null;
    readonly checkin: IsoDate;
    readonly checkout: IsoDate;
    readonly channel: Channel;
    readonly version: number;
  } | null;
  readonly kind: PaperMatchKind | null;
  readonly current: readonly PaperPiece[];
  readonly proposed: readonly PaperPiece[];
  readonly state: PaperItemState;
};

export type PaperPreview = {
  readonly items: readonly PaperItem[];
  /** Bookings in the same weeks that the Excel calendar does not have. */
  readonly notInCalendar: readonly {
    readonly id: string;
    readonly guestName: string | null;
    readonly checkin: IsoDate;
    readonly checkout: IsoDate;
    readonly current: readonly PaperPiece[];
  }[];
};

const PLACEABLE: BookingStatus[] = [BookingStatus.confirmed, BookingStatus.needs_reassignment];

type RoomRow = { id: string; code: string | null; displayName: string | null };

const roomLabel = (r: RoomRow) => r.displayName ?? r.code ?? r.id;

/** The app's apartment for each of the calendar's columns, found by name. */
async function paperRooms(): Promise<{ byColumn: RoomRow[]; names: Map<string, string> }> {
  const rooms = await prisma.room.findMany({ select: { id: true, code: true, displayName: true } });
  const byColumn = PAPER_APARTMENTS.map((name) => {
    const want = name.toLowerCase();
    const room = rooms.find(
      (r) => r.displayName?.trim().toLowerCase() === want || r.code?.trim().toLowerCase() === want,
    );
    if (!room) throw new DomainError("CALENDAR_APARTMENT_MISSING", { name });
    return room;
  });
  return { byColumn, names: new Map(rooms.map((r) => [r.id, roomLabel(r)])) };
}

const named = (pieces: readonly StayPiece[], names: Map<string, string>): PaperPiece[] =>
  pieces.map((p) => ({ ...p, roomName: names.get(p.roomId) ?? p.roomId }));

export async function previewPaperCalendar(file: Buffer, now = new Date()): Promise<PaperPreview> {
  const today = todayIso(now);
  let nights;
  try {
    nights = await readCalendarSheet(file);
  } catch (err) {
    if (err instanceof CalendarSheetError) throw new DomainError("NOT_A_CALENDAR");
    throw err;
  }
  const stays = paperStays(nights).filter((s) => s.start < today);
  if (stays.length === 0) return { items: [], notInCalendar: [] };
  const { byColumn, names } = await paperRooms();

  const from = stays.reduce((min, s) => (s.start < min ? s.start : min), stays[0]!.start);
  const to = stays.reduce((max, s) => (s.end > max ? s.end : max), stays[0]!.end);
  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: PLACEABLE },
      checkinDate: { lt: isoToDbDate(today < to ? today : to) },
      checkoutDate: { gt: isoToDbDate(from) },
    },
    orderBy: [{ checkinDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      guestName: true,
      checkinDate: true,
      checkoutDate: true,
      channel: true,
      version: true,
      assignments: { orderBy: { startDate: "asc" }, select: { roomId: true, startDate: true, endDate: true } },
    },
  });
  const plain = bookings.map((b) => ({
    id: b.id,
    guestName: b.guestName,
    checkin: dbDateToIso(b.checkinDate),
    checkout: dbDateToIso(b.checkoutDate),
    channel: b.channel,
    version: b.version,
    current: toPieces(b.assignments),
  }));
  const byId = new Map(plain.map((b) => [b.id, b]));

  const matches = matchPaperStays(stays, plain);
  const items: PaperItem[] = matches.map(({ stay, bookingId, kind }) => {
    const paper = stay.parts.map((p) => ({ roomId: byColumn[p.apartment]!.id, start: p.start, end: p.end }));
    const b = bookingId ? byId.get(bookingId)! : null;
    const proposed = b ? normalizePieces(fitPiecesToStay(paper, b.checkin, b.checkout)) : [];
    const state: PaperItemState = !b
      ? "missing"
      : b.current.length === 0
        ? "new"
        : samePieces(b.current, proposed)
          ? "same"
          : "change";
    return {
      paperName: stay.name,
      guests: stay.guests,
      paperStart: stay.start,
      paperEnd: stay.end,
      paperPieces: named(paper, names),
      booking: b
        ? {
            id: b.id,
            guestName: b.guestName,
            checkin: b.checkin,
            checkout: b.checkout,
            channel: b.channel,
            version: b.version,
          }
        : null,
      kind,
      current: b ? named(b.current, names) : [],
      proposed: named(proposed, names),
      state,
    };
  });
  const matched = new Set(matches.map((m) => m.bookingId));
  const notInCalendar = plain
    .filter((b) => !matched.has(b.id) && b.checkin >= from)
    .map((b) => ({
      id: b.id,
      guestName: b.guestName,
      checkin: b.checkin,
      checkout: b.checkout,
      current: named(b.current, names),
    }));
  return { items, notInCalendar };
}

export type PaperApplyItem = { bookingId: string; expectedVersion: number; pieces: StayPiece[] };

export type PaperSkipReason =
  "NOT_FOUND" | "BOOKING_CHANGED" | "NOT_CONFIRMED" | "INVALID_STAY" | "ROOM_INACTIVE" | "ROOM_TAKEN" | "ROOM_CLOSED";

export type PaperApplyResult = {
  readonly saved: number;
  readonly skipped: readonly {
    readonly bookingId: string;
    readonly guestName: string | null;
    readonly reason: PaperSkipReason;
    readonly otherGuest?: string | null;
  }[];
};

type Busy = { roomId: string; start: IsoDate; end: IsoDate; bookingId: string | null; guestName: string | null };

const overlaps = (a: { start: IsoDate; end: IsoDate }, b: { start: IsoDate; end: IsoDate }) =>
  a.start < b.end && b.start < a.end;

/** True when the pieces cover the stay night by night, back to back, from check-in to check-out. */
function coversStay(pieces: readonly StayPiece[], checkin: IsoDate, checkout: IsoDate): boolean {
  if (pieces.length === 0) return false;
  return (
    pieces[0]!.start === checkin &&
    pieces[pieces.length - 1]!.end === checkout &&
    pieces.every((p, i) => p.start < p.end && (i === 0 || pieces[i - 1]!.end === p.start))
  );
}

async function applyInTransaction(
  tx: Prisma.TransactionClient,
  input: readonly PaperApplyItem[],
  actorUserId: string,
  today: IsoDate,
): Promise<PaperApplyResult> {
  const skipped: PaperApplyResult["skipped"][number][] = [];
  const ids = [...new Set(input.map((i) => i.bookingId))];
  await tx.$executeRaw`SELECT id FROM bookings WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
  const bookings = await tx.booking.findMany({
    where: { id: { in: ids } },
    include: { assignments: { orderBy: { startDate: "asc" } } },
  });
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const roomIds = [...new Set(input.flatMap((i) => i.pieces.map((p) => p.roomId)))];
  const rooms = new Map(
    (await tx.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, isActive: true } })).map((r) => [
      r.id,
      r,
    ]),
  );

  type Chosen = { item: PaperApplyItem; booking: (typeof bookings)[number]; pieces: StayPiece[] };
  let chosen: Chosen[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const booking = byId.get(item.bookingId);
    const skip = (reason: PaperSkipReason) =>
      skipped.push({ bookingId: item.bookingId, guestName: booking?.guestName ?? null, reason });
    if (!booking || seen.has(item.bookingId)) {
      if (!booking) skip("NOT_FOUND");
      continue;
    }
    seen.add(item.bookingId);
    const pieces = normalizePieces(item.pieces);
    if (booking.version !== item.expectedVersion) skip("BOOKING_CHANGED");
    else if (!PLACEABLE.includes(booking.status)) skip("NOT_CONFIRMED");
    else if (!coversStay(pieces, dbDateToIso(booking.checkinDate), dbDateToIso(booking.checkoutDate)))
      skip("INVALID_STAY");
    else if (pieces.some((p) => !rooms.get(p.roomId)?.isActive)) skip("ROOM_INACTIVE");
    else if (!samePieces(toPieces(booking.assignments), pieces)) chosen.push({ item, booking, pieces });
  }
  if (chosen.length === 0) return { saved: 0, skipped };

  // What else is in those apartments on those nights: other guests, and closed nights.
  const from = chosen
    .flatMap((c) => c.pieces)
    .reduce((m, p) => (p.start < m ? p.start : m), chosen[0]!.pieces[0]!.start);
  const to = chosen.flatMap((c) => c.pieces).reduce((m, p) => (p.end > m ? p.end : m), chosen[0]!.pieces[0]!.end);
  const window = { startDate: { lt: isoToDbDate(to) }, endDate: { gt: isoToDbDate(from) }, roomId: { in: roomIds } };
  const others: Busy[] = (
    await tx.assignment.findMany({
      where: { ...window, booking: { status: { not: BookingStatus.cancelled } } },
      select: {
        roomId: true,
        startDate: true,
        endDate: true,
        bookingId: true,
        booking: { select: { guestName: true } },
      },
    })
  ).map((a) => ({
    roomId: a.roomId,
    start: dbDateToIso(a.startDate),
    end: dbDateToIso(a.endDate),
    bookingId: a.bookingId,
    guestName: a.booking.guestName,
  }));
  const blocks: Busy[] = (await tx.manualBlock.findMany({ where: window })).map((b) => ({
    roomId: b.roomId,
    start: dbDateToIso(b.startDate),
    end: dbDateToIso(b.endDate),
    bookingId: null,
    guestName: null,
  }));

  // A stay that clashes is left as it is, which keeps its old nights taken, so check again until nothing changes.
  for (let changed = true; changed;) {
    changed = false;
    const moving = new Set(chosen.map((c) => c.booking.id));
    const kept: Chosen[] = [];
    for (const c of chosen) {
      const busy: Busy[] = [
        ...blocks,
        ...others.filter((o) => o.bookingId !== null && !moving.has(o.bookingId)),
        ...kept.flatMap((k) =>
          k.pieces.map((p) => ({ ...p, bookingId: k.booking.id, guestName: k.booking.guestName })),
        ),
      ];
      const clash = busy.find((b) => c.pieces.some((p) => p.roomId === b.roomId && overlaps(p, b)));
      if (clash) {
        skipped.push({
          bookingId: c.booking.id,
          guestName: c.booking.guestName,
          reason: clash.bookingId === null ? "ROOM_CLOSED" : "ROOM_TAKEN",
          otherGuest: clash.guestName,
        });
        changed = true;
      } else kept.push(c);
    }
    chosen = kept;
  }

  // Old rows first, for every stay, so the no-overlap rule never sees a guest's old and another's new nights.
  for (const c of chosen) await tx.assignment.deleteMany({ where: { bookingId: c.booking.id } });
  for (const c of chosen) {
    for (const p of c.pieces) {
      await tx.assignment.create({
        data: {
          bookingId: c.booking.id,
          roomId: p.roomId,
          startDate: isoToDbDate(p.start),
          endDate: isoToDbDate(p.end),
          pinned: true,
          createdById: actorUserId,
          updatedById: actorUserId,
        },
      });
    }
    const updated = await tx.booking.update({
      where: { id: c.booking.id },
      data: {
        version: { increment: 1 },
        ...(c.booking.status === BookingStatus.needs_reassignment ? { status: BookingStatus.confirmed } : {}),
      },
      select: { version: true },
    });
    const before = toPieces(c.booking.assignments);
    await writeAuditSnapshot(tx, {
      actorUserId,
      action: "booking.move",
      entityType: "booking",
      entityId: c.booking.id,
      before: { roomId: before[0]?.roomId ?? null, pieces: before, version: c.booking.version },
      after: { roomId: c.pieces[0]!.roomId, pieces: c.pieces, version: updated.version },
      meta: { source: "excel-calendar" },
    });
  }
  // A guest who is still here gets the usual cleaning check for their check-out.
  for (const c of chosen) {
    if (dbDateToIso(c.booking.checkoutDate) <= today) continue;
    await ensureTurnoverCleaningTask(tx, {
      bookingId: c.booking.id,
      roomId: c.pieces[c.pieces.length - 1]!.roomId,
      checkoutDate: c.booking.checkoutDate,
    });
  }
  return { saved: chosen.length, skipped };
}

/** Saves the ticked stays in one go. A stay that changed meanwhile or clashes is skipped and reported. */
export async function applyPaperCalendar(
  input: readonly PaperApplyItem[],
  actorUserId: string,
  now = new Date(),
): Promise<PaperApplyResult> {
  if (input.length === 0) return { saved: 0, skipped: [] };
  const today = todayIso(now);
  const actor = (await prisma.user.findUnique({ where: { id: actorUserId }, select: { id: true } }))?.id;
  if (!actor) throw new DomainError("UNAUTHORIZED");
  try {
    return await prisma.$transaction((tx) => applyInTransaction(tx, input, actor, today), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 60_000,
    });
  } catch (err) {
    if (err instanceof DomainError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      throw new DomainError("BOOKING_CHANGED");
    }
    throw err;
  }
}

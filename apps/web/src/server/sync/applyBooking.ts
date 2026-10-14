import { writeAuditSnapshot } from "@stay-ops/audit";
import {
  BookingStatus,
  ensureTurnoverCleaningTask,
  findStayConflict,
  guessRentalIndexFromTitle,
  Prisma,
} from "@stay-ops/db";
import {
  applyCancellationSideEffects,
  mapHosthubBookingStatus,
  mapHosthubListingChannel,
  nightsBetweenCheckinCheckout,
  parseDateOnlyUtc,
  parseUpdatedUnix,
  type HosthubReservationDto,
} from "@stay-ops/sync";
import { fitPiecesToStay, isoDate, samePieces, type StayPiece } from "@stay-ops/domain";

type Dict = Record<string, unknown>;

/** One Hosthub calendar event to apply, with its raw payload and any notes / GR taxes fetched for it. */
export type IncomingBooking = {
  dto: HosthubReservationDto;
  raw: unknown;
  notesRaw?: unknown;
  grTaxesRaw?: unknown;
};

/** What applying one event did; the sync run counts these. */
export type ApplyOutcome = "created" | "updated" | "unchanged" | "stale";

function asObject(value: unknown): Dict | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** The calendar-event object inside a webhook or list payload (webhooks may wrap it). */
export function calendarEventOf(raw: unknown): Dict | null {
  const root = asObject(raw);
  if (!root) return null;
  if (typeof root.type === "string") return root;
  for (const key of ["calendar_event", "calendarEvent", "reservation", "data", "payload", "body"] as const) {
    const nested = asObject(root[key]);
    if (nested && typeof nested.type === "string") return nested;
  }
  return root;
}

/** Hosthub's `updated` for an event, as a Date, or null when the payload has none. */
export function hosthubUpdatedAt(raw: unknown): Date | null {
  const unix = parseUpdatedUnix(calendarEventOf(raw) ?? raw);
  return unix === undefined ? null : new Date(unix * 1000);
}

/** Booking columns sync writes from Hosthub, unless the user edited them in the app. */
export type SyncedBookingFields = {
  sourceListingId: string;
  status: BookingStatus;
  checkinDate: Date;
  checkoutDate: Date;
  nights: number;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  guestAdults: number | null;
  guestChildren: number | null;
  guestInfants: number | null;
  guestTotal: number | null;
  totalAmountCents: number | null;
  totalValueCents: number | null;
  currency: string | null;
  cleaningFeeCents: number | null;
  taxCents: number | null;
  payoutAmountCents: number | null;
  guestPaidCents: number | null;
  action: string | null;
  notes: string | null;
};

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/**
 * Update data for an existing booking: skips fields the user overrode in the app, keeps the
 * "needs a new apartment" status until the booking is placed again, and bumps `version` only when
 * a column actually changes. `changed` says whether anything the app shows is different.
 */
export function syncedBookingUpdate(
  existing: {
    status: BookingStatus;
    localOverrides: unknown;
    hosthubValues?: unknown;
    hosthubStatus: BookingStatus | null;
  } & Dict,
  incoming: SyncedBookingFields,
): { data: Prisma.BookingUncheckedUpdateInput; changed: boolean } {
  const overrides = { ...(asObject(existing.localOverrides) ?? {}) };
  const hosthubValues = { ...(asObject(existing.hosthubValues) ?? {}) };
  let hosthubValuesChanged = false;
  const data: Dict = {};
  let changed = false;
  if (overrides.status === true && existing.hosthubStatus !== incoming.status) {
    // Hosthub changed the status itself since the user set it in the app: Hosthub wins again.
    delete overrides.status;
    data.localOverrides = Object.keys(overrides).length > 0 ? overrides : Prisma.DbNull;
    changed = true;
  }
  for (const [key, value] of Object.entries(incoming) as [keyof SyncedBookingFields, unknown][]) {
    if (overrides[key] === true) {
      // Keep Hosthub's latest value beside the user's, for "Από Hosthub" and reset.
      const stored = value instanceof Date ? value.toISOString() : (value ?? null);
      if (hosthubValues[key] !== stored) {
        hosthubValues[key] = stored;
        hosthubValuesChanged = true;
      }
      continue;
    }
    let next = value;
    if (key === "status" && existing.status === BookingStatus.needs_reassignment && value === BookingStatus.confirmed) {
      next = BookingStatus.needs_reassignment;
    }
    data[key] = next;
    if (!sameValue(existing[key], next)) changed = true;
  }
  if (hosthubValuesChanged) data.hosthubValues = hosthubValues as Prisma.InputJsonValue;
  if (changed) data.version = { increment: 1 };
  data.hosthubStatus = incoming.status;
  return { data: data as Prisma.BookingUncheckedUpdateInput, changed };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayToDb(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function auditShape(b: {
  id: string;
  status: string;
  checkinDate: Date;
  checkoutDate: Date;
  nights: number;
  channel: string;
  externalBookingId: string;
  guestName: string | null;
  totalAmountCents: number | null;
}) {
  return {
    id: b.id,
    status: b.status,
    checkinDate: isoDay(b.checkinDate),
    checkoutDate: isoDay(b.checkoutDate),
    nights: b.nights,
    channel: b.channel,
    externalBookingId: b.externalBookingId,
    guestName: b.guestName,
    totalAmount: b.totalAmountCents === null ? null : b.totalAmountCents / 100,
  };
}

/**
 * The listing for this event. A brand-new rental also gets an apartment, switched off until it is
 * set up; sync never changes an apartment that already exists.
 */
async function ensureListingAndRoom(tx: Prisma.TransactionClient, dto: HosthubReservationDto) {
  const channel = mapHosthubListingChannel(dto.listingChannel);
  const title = dto.listingName?.trim() || null;
  const key = { channel_externalListingId: { channel, externalListingId: dto.listingId } };
  const listing = await tx.sourceListing.upsert({
    where: key,
    create: { channel, externalListingId: dto.listingId, title },
    update: { title },
  });
  if (listing.rentalIndex == null) {
    const guessed = guessRentalIndexFromTitle(listing.title ?? title);
    if (guessed != null) await tx.sourceListing.update({ where: { id: listing.id }, data: { rentalIndex: guessed } });
  }
  const room = await tx.room.findUnique({ where: { code: dto.listingId }, select: { id: true } });
  if (!room) {
    const created = await tx.room.create({
      data: { code: dto.listingId, displayName: title ?? dto.listingId, isActive: false },
    });
    await writeAuditSnapshot(tx, {
      actorUserId: null,
      entityType: "room",
      entityId: created.id,
      action: "room.created_by_sync",
      before: null,
      after: { id: created.id, code: created.code, displayName: created.displayName, isActive: false },
    });
  }
  return { channel, listing };
}

/**
 * Hosthub moved the dates of a booking that has an apartment. If the new dates still fit there
 * (apartment on, nobody else, not closed) the booking stays and its dates move; otherwise it
 * leaves the apartment and waits in "Χρειάζονται διαμέρισμα". A guest who moved apartment mid-stay keeps the
 * split: only the first piece follows a new check-in and only the last one a new check-out.
 */
async function followDateChange(
  tx: Prisma.TransactionClient,
  booking: { id: string; status: BookingStatus; checkinDate: Date; checkoutDate: Date },
): Promise<void> {
  if (booking.status === BookingStatus.cancelled) return;
  const rows = await tx.assignment.findMany({ where: { bookingId: booking.id }, orderBy: { startDate: "asc" } });
  const first = rows[0];
  if (!first) return;
  const pieces: StayPiece[] = rows.map((r) => ({
    roomId: r.roomId,
    start: isoDate(isoDay(r.startDate)),
    end: isoDate(isoDay(r.endDate)),
  }));
  const target = fitPiecesToStay(pieces, isoDate(isoDay(booking.checkinDate)), isoDate(isoDay(booking.checkoutDate)));
  if (samePieces(pieces, target)) return;

  const before = {
    id: first.id,
    roomId: first.roomId,
    startDate: isoDay(first.startDate),
    endDate: isoDay(rows[rows.length - 1]!.endDate),
    ...(rows.length > 1 ? { pieces } : {}),
  };
  const roomIds = [...new Set(target.map((p) => p.roomId))];
  const activeRooms = await tx.room.count({ where: { id: { in: roomIds }, isActive: true } });
  const roomsOn = activeRooms === roomIds.length;
  let conflict: Awaited<ReturnType<typeof findStayConflict>> = null;
  if (roomsOn) {
    for (const p of target) {
      conflict = await findStayConflict(tx, {
        roomId: p.roomId,
        start: dayToDb(p.start),
        end: dayToDb(p.end),
        excludeBookingId: booking.id,
      });
      if (conflict) break;
    }
  }

  if (roomsOn && conflict === null) {
    // Rows that keep their apartment and nights stay as they are; the changed ones are rewritten.
    const same = (r: (typeof rows)[number], p: StayPiece) =>
      r.roomId === p.roomId && isoDay(r.startDate) === p.start && isoDay(r.endDate) === p.end;
    const stale = rows.filter((r) => !target.some((p) => same(r, p)));
    const fresh = target.filter((p) => !rows.some((r) => same(r, p)));
    // A single piece moving dates keeps its row (and its id in the history); otherwise rows are replaced.
    const reuse = stale.length === 1 && fresh.length === 1 ? stale[0]! : null;
    if (reuse) {
      const p = fresh[0]!;
      await tx.assignment.update({
        where: { id: reuse.id },
        data: { roomId: p.roomId, startDate: dayToDb(p.start), endDate: dayToDb(p.end), version: { increment: 1 } },
      });
    } else {
      await tx.assignment.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
      for (const p of fresh) {
        await tx.assignment.create({
          data: {
            bookingId: booking.id,
            roomId: p.roomId,
            startDate: dayToDb(p.start),
            endDate: dayToDb(p.end),
            pinned: first.pinned,
          },
        });
      }
    }
    await writeAuditSnapshot(tx, {
      actorUserId: null,
      entityType: "assignment",
      entityId: first.id,
      action: "assignment.dates_followed_sync",
      before,
      after: {
        ...before,
        startDate: isoDay(booking.checkinDate),
        endDate: isoDay(booking.checkoutDate),
        ...(target.length > 1 ? { pieces: target } : {}),
      },
      meta: { bookingId: booking.id },
    });
    return;
  }

  await tx.assignment.deleteMany({ where: { bookingId: booking.id } });
  await tx.booking.update({
    where: { id: booking.id },
    data: { status: BookingStatus.needs_reassignment, version: { increment: 1 } },
  });
  await writeAuditSnapshot(tx, {
    actorUserId: null,
    entityType: "assignment",
    entityId: first.id,
    action: "assignment.cleared_on_sync_revalidation",
    before,
    after: null,
    meta: {
      bookingId: booking.id,
      reason: !roomsOn ? "ROOM_INACTIVE" : conflict?.kind === "assignment" ? "ROOM_TAKEN" : "ROOM_CLOSED",
      bookingCheckin: isoDay(booking.checkinDate),
      bookingCheckout: isoDay(booking.checkoutDate),
    },
  });
}

/**
 * Apply one Hosthub calendar event inside the caller's transaction. Writes only synced columns,
 * never local ones (apartment, overrides, pin), and ignores a delivery older than what is stored.
 */
export async function applyHosthubBooking(tx: Prisma.TransactionClient, item: IncomingBooking): Promise<ApplyOutcome> {
  const { dto } = item;
  const updatedAt = hosthubUpdatedAt(item.raw);
  const { channel, listing } = await ensureListingAndRoom(tx, dto);
  const key = { channel_externalBookingId: { channel, externalBookingId: dto.reservationId } };
  const existing = await tx.booking.findUnique({ where: key });

  if (existing?.hosthubUpdatedAt && updatedAt && updatedAt < existing.hosthubUpdatedAt) return "stale";

  const checkinDate = parseDateOnlyUtc(dto.checkIn);
  const checkoutDate = parseDateOnlyUtc(dto.checkOut);
  const fields: SyncedBookingFields = {
    sourceListingId: listing.id,
    status: mapHosthubBookingStatus(dto.status),
    checkinDate,
    checkoutDate,
    nights: nightsBetweenCheckinCheckout(checkinDate, checkoutDate),
    guestName: dto.guestName ?? null,
    guestEmail: dto.guestEmail ?? null,
    guestPhone: dto.guestPhone ?? null,
    guestAdults: dto.guestAdults ?? null,
    guestChildren: dto.guestChildren ?? null,
    guestInfants: dto.guestInfants ?? null,
    guestTotal: dto.guestTotal ?? null,
    totalAmountCents: dto.totalAmountCents ?? null,
    totalValueCents: dto.totalValueCents ?? null,
    currency: dto.currency ?? null,
    cleaningFeeCents: dto.cleaningFeeCents ?? null,
    taxCents: dto.taxCents ?? null,
    payoutAmountCents: dto.payoutAmountCents ?? null,
    guestPaidCents: dto.guestPaidCents ?? null,
    action: dto.action ?? null,
    notes: dto.notes ?? null,
  };
  const event = calendarEventOf(item.raw);
  const rawColumns = {
    rawPayload: toJson(item.raw),
    ...(event ? { hosthubCalendarEventRaw: toJson(event) } : {}),
    ...(item.notesRaw != null ? { hosthubNotesRaw: toJson(item.notesRaw) } : {}),
    ...(item.grTaxesRaw != null ? { hosthubGrTaxesRaw: toJson(item.grTaxesRaw) } : {}),
    ...(updatedAt ? { hosthubUpdatedAt: updatedAt } : {}),
  };

  if (!existing) {
    const created = await tx.booking.create({
      data: { ...fields, channel, externalBookingId: dto.reservationId, hosthubStatus: fields.status, ...rawColumns },
    });
    await writeAuditSnapshot(tx, {
      actorUserId: null,
      entityType: "booking",
      entityId: created.id,
      action: "booking.sync_upsert",
      before: null,
      after: auditShape(created),
      meta: { bookingId: created.id, source: "sync" },
    });
    return "created";
  }

  const { data, changed } = syncedBookingUpdate(existing, fields);
  const sameDelivery = updatedAt !== null && existing.hosthubUpdatedAt?.getTime() === updatedAt.getTime();
  if (!changed && sameDelivery && item.notesRaw == null && item.grTaxesRaw == null) return "unchanged";
  const booking = await tx.booking.update({ where: { id: existing.id }, data: { ...data, ...rawColumns } });
  if (!changed) return "unchanged";

  if (
    booking.checkinDate.getTime() !== existing.checkinDate.getTime() ||
    booking.checkoutDate.getTime() !== existing.checkoutDate.getTime()
  ) {
    await followDateChange(tx, booking);
  }
  if (booking.status === BookingStatus.cancelled) {
    await applyCancellationSideEffects(tx, booking.id, null);
  } else {
    // The checkout cleaning belongs to the apartment the guest leaves from (the last piece).
    const assignment = await tx.assignment.findFirst({
      where: { bookingId: booking.id },
      orderBy: { startDate: "desc" },
    });
    if (assignment) {
      await ensureTurnoverCleaningTask(tx, {
        bookingId: booking.id,
        roomId: assignment.roomId,
        checkoutDate: booking.checkoutDate,
      });
    }
  }
  const after = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
  await writeAuditSnapshot(tx, {
    actorUserId: null,
    entityType: "booking",
    entityId: booking.id,
    action: "booking.sync_upsert",
    before: auditShape(existing),
    after: auditShape(after),
    meta: { bookingId: booking.id, source: "sync" },
  });
  return "updated";
}

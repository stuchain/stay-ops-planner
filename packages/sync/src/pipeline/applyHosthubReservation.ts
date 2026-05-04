import { writeAuditSnapshot } from "@stay-ops/audit";
import { invalidateCalendarMonthsForUtcRange, resolveAppTimeZone } from "@stay-ops/shared/calendar-month-cache";
import { DryRunRollback, PlanRecorder, log, withRetry } from "@stay-ops/shared";
import type { Prisma } from "@stay-ops/db";
import {
  BookingStatus,
  ensureTurnoverCleaningTask,
  guessRentalIndexFromTitle,
  PrismaClient,
  TURNOVER_TASK_TYPE,
} from "@stay-ops/db";
import type { HosthubReservationDto } from "../hosthub/types.dto.js";
import { applyCancellationSideEffects } from "../allocation/cancellation.js";
import { revalidateAssignmentIfNeeded } from "../allocation/revalidateAssignment.js";
import { mapHosthubBookingStatus } from "./bookingStatus.js";
import { mapHosthubListingChannel } from "./mapChannel.js";
import { nightsBetweenCheckinCheckout, parseDateOnlyUtc } from "./dates.js";
import { isTransientPrismaError, pickPrismaErrorCode } from "../retry/isTransient.js";

type Dict = Record<string, unknown>;

function asObject(value: unknown): Dict | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Dict;
  return null;
}

function toJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function pickCalendarEventRaw(rawPayload: Prisma.InputJsonValue): Prisma.InputJsonValue | null {
  const root = asObject(rawPayload as unknown);
  if (!root) return null;
  const type = root.type;
  if (typeof type === "string") return toJson(root);
  for (const key of ["calendar_event", "calendarEvent", "reservation", "data", "payload", "body"] as const) {
    const nested = asObject(root[key]);
    if (nested && typeof nested.type === "string") {
      return toJson(nested);
    }
  }
  return toJson(root);
}

function centsToAmount(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return cents / 100;
}

function bookingAuditShape(b: {
  id: string;
  status: string;
  checkinDate: Date;
  checkoutDate: Date;
  nights: number;
  channel: string;
  externalBookingId: string;
  guestName?: string | null;
  totalAmountCents?: number | null;
}) {
  return {
    id: b.id,
    status: b.status,
    checkinDate: b.checkinDate.toISOString().slice(0, 10),
    checkoutDate: b.checkoutDate.toISOString().slice(0, 10),
    nights: b.nights,
    channel: b.channel,
    externalBookingId: b.externalBookingId,
    guestName: b.guestName ?? null,
    totalAmount: centsToAmount(b.totalAmountCents ?? null),
  };
}

export type ApplyHosthubReservationRunOptions = {
  dryRun?: boolean;
  recorder?: PlanRecorder;
};

async function upsertListingAndBooking(
  tx: Prisma.TransactionClient,
  dto: HosthubReservationDto,
  rawPayload: Prisma.InputJsonValue,
  extra:
    | {
        hosthubNotesRaw?: Prisma.InputJsonValue | null;
        hosthubGrTaxesRaw?: Prisma.InputJsonValue | null;
      }
    | undefined,
  syncCtx: { dryRun: boolean; recorder?: PlanRecorder },
) {
  const { dryRun, recorder } = syncCtx;
  const channel = mapHosthubListingChannel(dto.listingChannel);
  const checkinDate = parseDateOnlyUtc(dto.checkIn);
  const checkoutDate = parseDateOnlyUtc(dto.checkOut);
  const nights = nightsBetweenCheckinCheckout(checkinDate, checkoutDate);
  const status = mapHosthubBookingStatus(dto.status);
  const listingName = dto.listingName?.trim() ? dto.listingName.trim() : null;
  const calendarEventRaw = pickCalendarEventRaw(rawPayload);

  const existingBooking = await tx.booking.findUnique({
    where: {
      channel_externalBookingId: {
        channel,
        externalBookingId: dto.reservationId,
      },
    },
  });
  const stayDatesChanged =
    existingBooking !== null &&
    (existingBooking.checkinDate.getTime() !== checkinDate.getTime() ||
      existingBooking.checkoutDate.getTime() !== checkoutDate.getTime());

  const existingListing = await tx.sourceListing.findUnique({
    where: {
      channel_externalListingId: {
        channel,
        externalListingId: dto.listingId,
      },
    },
  });

  const listing = await tx.sourceListing.upsert({
    where: {
      channel_externalListingId: {
        channel,
        externalListingId: dto.listingId,
      },
    },
    create: {
      channel,
      externalListingId: dto.listingId,
      title: listingName,
    },
    update: { title: listingName },
  });

  recorder?.push({
    entityType: "source_listing",
    entityId: listing.id,
    action: existingListing ? "update" : "create",
    before: existingListing
      ? { id: existingListing.id, title: existingListing.title, externalListingId: existingListing.externalListingId }
      : null,
    after: { id: listing.id, title: listing.title, externalListingId: listing.externalListingId },
  });

  if (listing.rentalIndex == null) {
    const guessed = guessRentalIndexFromTitle(listing.title ?? listingName);
    if (guessed != null) {
      await tx.sourceListing.update({
        where: { id: listing.id },
        data: { rentalIndex: guessed },
      });
      recorder?.push({
        entityType: "source_listing",
        entityId: listing.id,
        action: "update",
        before: { rentalIndex: listing.rentalIndex },
        after: { rentalIndex: guessed },
      });
    }
  }

  const existingRoom = await tx.room.findUnique({
    where: { code: listing.externalListingId },
  });

  const roomRow = await tx.room.upsert({
    where: { code: listing.externalListingId },
    create: {
      code: listing.externalListingId,
      displayName: listing.title ?? listing.externalListingId,
      isActive: true,
    },
    update: {
      displayName: listing.title ?? listing.externalListingId,
      isActive: true,
    },
  });

  recorder?.push({
    entityType: "room",
    entityId: roomRow.id,
    action: existingRoom ? "update" : "create",
    before: existingRoom
      ? {
          id: existingRoom.id,
          code: existingRoom.code,
          displayName: existingRoom.displayName,
          isActive: existingRoom.isActive,
        }
      : null,
    after: {
      id: roomRow.id,
      code: roomRow.code,
      displayName: roomRow.displayName,
      isActive: roomRow.isActive,
    },
  });

  const booking = await tx.booking.upsert({
    where: {
      channel_externalBookingId: {
        channel,
        externalBookingId: dto.reservationId,
      },
    },
    create: {
      sourceListingId: listing.id,
      channel,
      externalBookingId: dto.reservationId,
      status,
      checkinDate,
      checkoutDate,
      nights,
      guestName: dto.guestName ?? null,
      guestEmail: dto.guestEmail ?? null,
      guestPhone: dto.guestPhone ?? null,
      guestAdults: dto.guestAdults ?? null,
      guestChildren: dto.guestChildren ?? null,
      guestInfants: dto.guestInfants ?? null,
      guestTotal: dto.guestTotal ?? null,
      totalAmountCents: dto.totalAmountCents ?? null,
      currency: dto.currency ?? null,
      cleaningFeeCents: dto.cleaningFeeCents ?? null,
      taxCents: dto.taxCents ?? null,
      payoutAmountCents: dto.payoutAmountCents ?? null,
      guestPaidCents: dto.guestPaidCents ?? null,
      action: dto.action ?? null,
      notes: dto.notes ?? null,
      ...(calendarEventRaw !== null ? { hosthubCalendarEventRaw: calendarEventRaw } : {}),
      ...(extra?.hosthubNotesRaw !== undefined && extra.hosthubNotesRaw !== null
        ? { hosthubNotesRaw: extra.hosthubNotesRaw }
        : {}),
      ...(extra?.hosthubGrTaxesRaw !== undefined && extra.hosthubGrTaxesRaw !== null
        ? { hosthubGrTaxesRaw: extra.hosthubGrTaxesRaw }
        : {}),
      rawPayload,
    },
    update: {
      sourceListingId: listing.id,
      status,
      checkinDate,
      checkoutDate,
      nights,
      guestName: dto.guestName ?? null,
      guestEmail: dto.guestEmail ?? null,
      guestPhone: dto.guestPhone ?? null,
      guestAdults: dto.guestAdults ?? null,
      guestChildren: dto.guestChildren ?? null,
      guestInfants: dto.guestInfants ?? null,
      guestTotal: dto.guestTotal ?? null,
      totalAmountCents: dto.totalAmountCents ?? null,
      currency: dto.currency ?? null,
      cleaningFeeCents: dto.cleaningFeeCents ?? null,
      taxCents: dto.taxCents ?? null,
      payoutAmountCents: dto.payoutAmountCents ?? null,
      guestPaidCents: dto.guestPaidCents ?? null,
      action: dto.action ?? null,
      notes: dto.notes ?? null,
      ...(calendarEventRaw !== null ? { hosthubCalendarEventRaw: calendarEventRaw } : {}),
      ...(extra?.hosthubNotesRaw !== undefined && extra.hosthubNotesRaw !== null
        ? { hosthubNotesRaw: extra.hosthubNotesRaw }
        : {}),
      ...(extra?.hosthubGrTaxesRaw !== undefined && extra.hosthubGrTaxesRaw !== null
        ? { hosthubGrTaxesRaw: extra.hosthubGrTaxesRaw }
        : {}),
      rawPayload,
    },
  });

  recorder?.push({
    entityType: "booking",
    entityId: booking.id,
    action: existingBooking ? "update" : "create",
    before: existingBooking ? bookingAuditShape(existingBooking) : null,
    after: bookingAuditShape(booking),
  });

  if (stayDatesChanged) {
    await revalidateAssignmentIfNeeded(tx, booking.id, {
      skipAudit: dryRun,
      recorder: dryRun ? recorder : undefined,
    });
  }

  const afterRevalidate = await tx.booking.findUnique({
    where: { id: booking.id },
    include: { assignment: true },
  });
  if (
    afterRevalidate &&
    afterRevalidate.status !== BookingStatus.cancelled &&
    afterRevalidate.assignment
  ) {
    await ensureTurnoverCleaningTask(tx, {
      bookingId: afterRevalidate.id,
      roomId: afterRevalidate.assignment.roomId,
      checkoutDate: afterRevalidate.checkoutDate,
    });
    if (recorder) {
      const turnover = await tx.cleaningTask.findFirst({
        where: { bookingId: afterRevalidate.id, taskType: TURNOVER_TASK_TYPE },
      });
      if (turnover) {
        recorder.push({
          entityType: "cleaning_task",
          entityId: turnover.id,
          action: "upsert",
          before: null,
          after: {
            id: turnover.id,
            taskType: turnover.taskType,
            status: turnover.status,
            roomId: turnover.roomId,
            plannedStart: turnover.plannedStart?.toISOString() ?? null,
            plannedEnd: turnover.plannedEnd?.toISOString() ?? null,
          },
        });
      }
    }
  }

  if (booking.status === BookingStatus.cancelled) {
    await applyCancellationSideEffects(tx, booking.id, null, {
      skipAudit: dryRun,
      recorder: dryRun ? recorder : undefined,
    });
  }

  const finalBooking = await tx.booking.findUnique({ where: { id: booking.id } });
  if (finalBooking && !dryRun) {
    await writeAuditSnapshot(tx, {
      actorUserId: null,
      entityType: "booking",
      entityId: finalBooking.id,
      action: "booking.sync_upsert",
      before: existingBooking ? bookingAuditShape(existingBooking) : null,
      after: bookingAuditShape(finalBooking),
      meta: { bookingId: finalBooking.id, source: "sync" },
    });
  }
}

/**
 * Upsert source listing + canonical booking from a normalized Hosthub reservation DTO.
 */
export async function applyHosthubReservation(
  prisma: PrismaClient,
  dto: HosthubReservationDto,
  rawPayload: Prisma.InputJsonValue,
  extra?: {
    hosthubNotesRaw?: Prisma.InputJsonValue | null;
    hosthubGrTaxesRaw?: Prisma.InputJsonValue | null;
  },
  runOpts?: ApplyHosthubReservationRunOptions,
): Promise<void> {
  const dryRun = runOpts?.dryRun ?? false;
  const recorder = runOpts?.recorder ?? (dryRun ? new PlanRecorder() : undefined);
  const syncCtx = { dryRun, recorder };

  await withRetry(
    () =>
      prisma.$transaction(async (tx) => {
        await upsertListingAndBooking(tx, dto, rawPayload, extra, syncCtx);
        if (dryRun && recorder) {
          throw new DryRunRollback(recorder.snapshot());
        }
      }),
    {
      maxAttempts: 3,
      isTransient: isTransientPrismaError,
      onRetry: ({ attempt, delayMs, err }) => {
        log("warn", "retry_attempt", {
          op: "applyHosthubReservation",
          attempt,
          delayMs,
          code: pickPrismaErrorCode(err),
        });
      },
      onExhausted: ({ attempts, elapsedMs, cause }) => {
        log("error", "retry_exhausted", {
          op: "applyHosthubReservation",
          attempts,
          elapsedMs,
          code: pickPrismaErrorCode(cause),
        });
      },
    },
  );

  if (!dryRun) {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (redisUrl) {
      const channel = mapHosthubListingChannel(dto.listingChannel);
      try {
        const row = await prisma.booking.findUnique({
          where: {
            channel_externalBookingId: { channel, externalBookingId: dto.reservationId },
          },
          include: { assignment: true },
        });
        if (row) {
          let from = row.checkinDate;
          let to = row.checkoutDate;
          if (row.assignment) {
            if (row.assignment.startDate.getTime() < from.getTime()) from = row.assignment.startDate;
            if (row.assignment.endDate.getTime() > to.getTime()) to = row.assignment.endDate;
          }
          void invalidateCalendarMonthsForUtcRange(redisUrl, resolveAppTimeZone(), from, to).catch((e) => {
            log("warn", "calendar_month_cache_invalidate_failed", {
              op: "applyHosthubReservation",
              err: e instanceof Error ? e.message : String(e),
            });
          });
        }
      } catch (e) {
        log("warn", "calendar_month_cache_invalidate_lookup_failed", {
          op: "applyHosthubReservation",
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
}

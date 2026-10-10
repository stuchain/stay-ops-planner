import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { writeAuditSnapshot } from "@stay-ops/audit";
import { BookingStatus, Prisma } from "@stay-ops/db";
import { applyCancellationSideEffects } from "@stay-ops/sync";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { AuthError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { InvalidBookingStatusTransitionError, assertBookingStatusTransition } from "@/modules/booking/statusTransition";
import { bookingToAuditSnapshot } from "@/modules/bookings/bookingAuditSnapshot";
import { bookingDetailFromModel } from "@/modules/bookings/details";

const PatchBodySchema = z
  .object({
    status: z.nativeEnum(BookingStatus).optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
    editable: z
      .object({
        guestName: z.string().trim().min(1).max(160).optional(),
        email: z.string().trim().max(200).optional(),
        phone: z.string().trim().max(80).optional(),
        adults: z.number().int().min(0).optional(),
        children: z.number().int().min(0).optional(),
        infants: z.number().int().min(0).optional(),
        totalGuests: z.number().int().min(0).optional(),
        totalValue: z.number().min(0).optional(),
        currency: z.string().trim().max(20).optional(),
        notes: z.string().trim().max(5000).optional(),
        action: z.string().trim().max(120).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireOperatorOrAdmin(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(request, err.code, err.message, err.status, err.details);
    }
    throw err;
  }

  const { id } = await ctx.params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      assignment: true,
      sourceListing: { select: { title: true } },
    },
  });
  if (!booking) {
    return apiError(request, "NOT_FOUND", "Booking not found", 404);
  }

  return attachTraceToResponse(request, NextResponse.json({ data: bookingDetailFromModel(booking) }));
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireOperatorOrAdmin(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(request, "VALIDATION_ERROR", "Invalid request body", 400);
    }
    const parsed = PatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(request, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    }

    const { id } = await ctx.params;
    const existing = await prisma.booking.findUnique({
      where: { id },
      select: { id: true, status: true, version: true, localOverrides: true },
    });
    if (!existing) {
      return apiError(request, "NOT_FOUND", "Booking not found", 404);
    }

    if (parsed.data.expectedVersion !== undefined && parsed.data.expectedVersion !== existing.version) {
      return apiError(request, "STALE_VERSION", "Stale booking version", 409, {
        expectedVersion: parsed.data.expectedVersion,
        currentVersion: existing.version,
      });
    }

    const updateData: Prisma.BookingUpdateInput = {};
    if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
      try {
        assertBookingStatusTransition(existing.status, parsed.data.status);
      } catch (err) {
        if (err instanceof InvalidBookingStatusTransitionError) {
          return apiError(request, "INVALID_STATUS_TRANSITION", err.message, 422, {
            from: err.from,
            to: err.to,
          });
        }
        throw err;
      }
      updateData.status = parsed.data.status;
    }
    if (parsed.data.editable !== undefined) {
      const e = parsed.data.editable;
      const edited: Partial<Record<keyof Prisma.BookingUncheckedUpdateInput, unknown>> = {
        guestName: e.guestName,
        guestEmail: e.email,
        guestPhone: e.phone,
        guestAdults: e.adults,
        guestChildren: e.children,
        guestInfants: e.infants,
        guestTotal: e.totalGuests,
        totalAmountCents: e.totalValue === undefined ? undefined : Math.round(e.totalValue * 100),
        currency: e.currency,
        notes: e.notes,
        action: e.action,
      };
      // Remember which columns the user changed, so the next Hosthub sync leaves them alone.
      const overrides: Record<string, boolean> = {
        ...(existing.localOverrides && typeof existing.localOverrides === "object" && !Array.isArray(existing.localOverrides)
          ? (existing.localOverrides as Record<string, boolean>)
          : {}),
      };
      for (const [column, value] of Object.entries(edited)) {
        if (value === undefined) continue;
        (updateData as Record<string, unknown>)[column] = value;
        overrides[column] = true;
      }
      if (Object.keys(overrides).length > 0) updateData.localOverrides = overrides;
    }
    if (Object.keys(updateData).length === 0) {
      return apiError(request, "VALIDATION_ERROR", "No changes provided", 400);
    }

    const auditMeta = auditMetaFromRequest(request);

    try {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`;

        const locked = await tx.booking.findUnique({
          where: { id },
          select: {
            version: true,
            status: true,
            guestName: true,
            guestEmail: true,
            guestPhone: true,
            guestAdults: true,
            guestChildren: true,
            guestInfants: true,
            guestTotal: true,
            totalAmountCents: true,
            currency: true,
            notes: true,
            action: true,
          },
        });
        if (!locked) {
          throw new Error("BOOKING_NOT_FOUND");
        }
        if (parsed.data.expectedVersion !== undefined && parsed.data.expectedVersion !== locked.version) {
          throw Object.assign(new Error("STALE_VERSION"), { code: "STALE_VERSION" as const });
        }

        const becameCancelled =
          parsed.data.status === BookingStatus.cancelled && locked.status !== BookingStatus.cancelled;

        const beforeSnapshot = bookingToAuditSnapshot(locked);

        let row;
        if (parsed.data.expectedVersion !== undefined) {
          const result = await tx.booking.updateMany({
            where: { id, version: parsed.data.expectedVersion },
            data: { ...updateData, version: { increment: 1 } },
          });
          if (result.count === 0) {
            throw Object.assign(new Error("STALE_VERSION"), { code: "STALE_VERSION" as const });
          }
          row = await tx.booking.findUniqueOrThrow({
            where: { id },
            include: {
              assignment: true,
              sourceListing: { select: { title: true } },
            },
          });
        } else {
          row = await tx.booking.update({
            where: { id },
            data: { ...updateData, version: { increment: 1 } },
            include: {
              assignment: true,
              sourceListing: { select: { title: true } },
            },
          });
        }

        await writeAuditSnapshot(tx, {
          actorUserId: session.userId,
          action: "booking.update",
          entityType: "booking",
          entityId: id,
          before: beforeSnapshot,
          after: bookingToAuditSnapshot(row),
          meta: { bookingId: id, ...auditMeta },
        });

        if (becameCancelled) {
          await applyCancellationSideEffects(tx, id, session.userId, { skipAudit: false });
        }

        return row;
      });

      return attachTraceToResponse(
        request,
        NextResponse.json({
          data: {
            booking: bookingDetailFromModel(updated),
            syncMode: "pull_only",
            hosthubWriteback: false,
          },
        }),
      );
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "STALE_VERSION") {
        return apiError(request, "STALE_VERSION", "Stale booking version", 409);
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(request, err.code, err.message, err.status, err.details);
    }
    throw err;
  }
}

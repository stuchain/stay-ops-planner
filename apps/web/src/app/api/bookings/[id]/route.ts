import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BookingStatus } from "@stay-ops/db";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { AuthError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { bookingDetailFromModel, mergeEditablePayload } from "@/modules/bookings/details";

const PatchBodySchema = z
  .object({
    status: z.nativeEnum(BookingStatus).optional(),
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
    await requireOperatorOrAdmin(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(request, err.code, err.message, err.status, err.details);
    }
    throw err;
  }

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
    select: { id: true, rawPayload: true },
  });
  if (!existing) {
    return apiError(request, "NOT_FOUND", "Booking not found", 404);
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.editable !== undefined) {
    if (parsed.data.editable.guestName !== undefined) updateData.guestName = parsed.data.editable.guestName;
    if (parsed.data.editable.email !== undefined) updateData.guestEmail = parsed.data.editable.email;
    if (parsed.data.editable.phone !== undefined) updateData.guestPhone = parsed.data.editable.phone;
    if (parsed.data.editable.adults !== undefined) updateData.guestAdults = parsed.data.editable.adults;
    if (parsed.data.editable.children !== undefined) updateData.guestChildren = parsed.data.editable.children;
    if (parsed.data.editable.infants !== undefined) updateData.guestInfants = parsed.data.editable.infants;
    if (parsed.data.editable.totalGuests !== undefined) updateData.guestTotal = parsed.data.editable.totalGuests;
    if (parsed.data.editable.totalValue !== undefined) updateData.totalAmountCents = Math.round(parsed.data.editable.totalValue * 100);
    if (parsed.data.editable.currency !== undefined) updateData.currency = parsed.data.editable.currency;
    if (parsed.data.editable.notes !== undefined) updateData.notes = parsed.data.editable.notes;
    if (parsed.data.editable.action !== undefined) updateData.action = parsed.data.editable.action;
    updateData.rawPayload = mergeEditablePayload(existing.rawPayload, parsed.data.editable as Record<string, unknown>);
  }
  if (Object.keys(updateData).length === 0) {
    return apiError(request, "VALIDATION_ERROR", "No changes provided", 400);
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: updateData,
    include: {
      assignment: true,
      sourceListing: { select: { title: true } },
    },
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
}

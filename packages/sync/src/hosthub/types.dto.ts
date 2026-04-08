import { z } from "zod";

/**
 * Canonical reservation row after normalization (see `normalizeHosthubReservationRecord`).
 * For Hosthub calendar events, `reservationId` is the **calendar event `id`** (stable key), not channel `reservation_id`.
 */
export const HosthubReservationDtoSchema = z.object({
  reservationId: z.string().min(1),
  listingId: z.string().min(1),
  listingName: z.string().min(1).optional(),
  guestName: z.string().min(1).optional(),
  guestEmail: z.string().min(1).optional(),
  guestPhone: z.string().min(1).optional(),
  guestAdults: z.number().int().min(0).optional(),
  guestChildren: z.number().int().min(0).optional(),
  guestInfants: z.number().int().min(0).optional(),
  guestTotal: z.number().int().min(0).optional(),
  totalAmountCents: z.number().int().optional(),
  currency: z.string().min(1).optional(),
  cleaningFeeCents: z.number().int().optional(),
  taxCents: z.number().int().optional(),
  payoutAmountCents: z.number().int().optional(),
  guestPaidCents: z.number().int().optional(),
  action: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  status: z.enum(["confirmed", "cancelled", "pending"]),
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  /** Optional source hint from Hosthub (airbnb, booking.com, etc.). */
  listingChannel: z.string().optional(),
});

export type HosthubReservationDto = z.infer<typeof HosthubReservationDtoSchema>;

export const HosthubReservationPageSchema = z.object({
  data: z.array(HosthubReservationDtoSchema),
  /** Full raw item per normalized row; aligned by index with `data`. */
  rawData: z.array(z.unknown()).optional(),
  /** Next page URL from Hosthub `navigation.next` (follow verbatim). */
  nextPageUrl: z.string().nullable(),
  skipped: z.number().int().nonnegative(),
  /** Max `updated` (Unix) seen on this page from raw items, for poll watermark. */
  maxUpdated: z.number().optional(),
});

export type HosthubReservationPage = z.infer<typeof HosthubReservationPageSchema>;

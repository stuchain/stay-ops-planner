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
  status: z.enum(["confirmed", "cancelled", "pending"]),
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  /** Optional source hint from Hosthub (airbnb, booking.com, etc.). */
  listingChannel: z.string().optional(),
});

export type HosthubReservationDto = z.infer<typeof HosthubReservationDtoSchema>;

export const HosthubReservationPageSchema = z.object({
  data: z.array(HosthubReservationDtoSchema),
  /** Next page URL from Hosthub `navigation.next` (follow verbatim). */
  nextPageUrl: z.string().nullable(),
  skipped: z.number().int().nonnegative(),
  /** Max `updated` (Unix) seen on this page from raw items, for poll watermark. */
  maxUpdated: z.number().optional(),
});

export type HosthubReservationPage = z.infer<typeof HosthubReservationPageSchema>;

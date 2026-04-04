import { z } from "zod";

/** Canonical reservation row after normalization (see `normalizeHosthubReservationRecord` and https://www.hosthub.com/docs/api/). */
export const HosthubReservationDtoSchema = z.object({
  reservationId: z.string().min(1),
  listingId: z.string().min(1),
  status: z.enum(["confirmed", "cancelled", "pending"]),
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  /** Optional source hint from Hosthub (airbnb, booking.com, etc.). */
  listingChannel: z.string().optional(),
});

export type HosthubReservationDto = z.infer<typeof HosthubReservationDtoSchema>;

export const HosthubReservationPageSchema = z.object({
  data: z.array(HosthubReservationDtoSchema),
  nextCursor: z.string().nullable().optional(),
});

export type HosthubReservationPage = z.infer<typeof HosthubReservationPageSchema>;

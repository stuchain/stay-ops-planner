import { z } from "zod";

/** Single reservation as returned by Hosthub-style list APIs (stub; align with OpenAPI when available). */
export const HosthubReservationDtoSchema = z.object({
  reservationId: z.string().min(1),
  listingId: z.string().min(1),
  status: z.enum(["confirmed", "cancelled", "pending"]),
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
});

export type HosthubReservationDto = z.infer<typeof HosthubReservationDtoSchema>;

export const HosthubReservationPageSchema = z.object({
  data: z.array(HosthubReservationDtoSchema),
  nextCursor: z.string().nullable().optional(),
});

export type HosthubReservationPage = z.infer<typeof HosthubReservationPageSchema>;

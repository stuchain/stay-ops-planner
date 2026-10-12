import { isIsoDate, type IsoDate } from "@stay-ops/domain";
import { z } from "zod";
import { EDITABLE_FIELDS, resetBookingField, updateBookingDetails } from "@/server/useCases/bookingEdit";
import { bookingHistory } from "@/server/useCases/bookingHistory";
import { getBookingDetails } from "@/server/useCases/bookingDetails";
import { bookingSuggestions } from "@/server/useCases/bookingSuggestions";
import { getGuestMessageTemplates } from "@/server/useCases/guestMessageTemplates";
import { getArrivalCards } from "@/server/useCases/arrivalCards";
import { getPreviousStays } from "@/server/useCases/previousStays";
import { GUEST_NOTE_MAX, setGuestNote } from "@/server/useCases/guestNote";
import { moveBooking } from "@/server/useCases/moveBooking";
import { searchBookings } from "@/server/useCases/bookingSearch";
import { createTRPCRouter, operatorProcedure, userProcedure } from "../trpc";

const day = z
  .string()
  .refine(isIsoDate, "Not a calendar date")
  .transform((s) => s as IsoDate);

export const bookingRouter = createTRPCRouter({
  /** Find bookings by guest name, phone, e-mail and/or dates, past and future. */
  search: userProcedure
    .input(
      z.object({
        text: z.string().max(100).optional(),
        from: day.optional(),
        to: day.optional(),
        includeCancelled: z.boolean().optional(),
      }),
    )
    .query(({ input }) => searchBookings(input)),

  /** Place, move or take out a booking. Viewers cannot. */
  move: operatorProcedure
    .input(
      z.object({
        bookingId: z.string().min(1),
        roomId: z.string().min(1).nullable(),
        expectedVersion: z.number().int().nonnegative(),
        confirmStarted: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => moveBooking({ ...input, actorUserId: ctx.user.userId })),

  /** Guest, dates, party, amount and notes for the booking panel. */
  /** Read-only (family) accounts never get the price. */
  details: userProcedure.input(z.object({ bookingId: z.string().min(1) })).query(async ({ ctx, input }) => {
    const details = await getBookingDetails(input.bookingId);
    return ctx.user.role === "viewer" ? { ...details, price: null } : details;
  }),

  /** Earlier stays of the same guest (same phone or e-mail), and weaker same-name hints. */
  previousStays: userProcedure
    .input(z.object({ bookingId: z.string().min(1) }))
    .query(({ input }) => getPreviousStays(input.bookingId)),

  /** Save the team's own note about the guest; it comes back when the same guest books again. Viewers cannot. */
  setGuestNote: operatorProcedure
    .input(z.object({ bookingId: z.string().min(1), note: z.string().max(GUEST_NOTE_MAX) }))
    .mutation(({ ctx, input }) => setGuestNote({ ...input, actorUserId: ctx.user.userId })),

  /** The printable arrival cards (Κάρτες άφιξης) for up to 30 bookings, in check-in order. */
  arrivalCards: userProcedure
    .input(z.object({ ids: z.array(z.string().min(1)).min(1).max(30) }))
    .query(({ input }) => getArrivalCards(input.ids)),

  /** The guest message texts (saved and built-in) for the booking panel. Anyone signed in may read them. */
  messageTemplates: userProcedure.query(() => getGuestMessageTemplates()),

  /** Every apartment for this booking, best first, with reasons. */
  suggestions: userProcedure
    .input(z.object({ bookingId: z.string().min(1) }))
    .query(({ input }) => bookingSuggestions(input.bookingId)),

  /** Change the guest name, number of people or notes. Hosthub's value is kept so it can be restored. */
  updateDetails: operatorProcedure
    .input(
      z.object({
        bookingId: z.string().min(1),
        expectedVersion: z.number().int().nonnegative(),
        guestName: z.string().max(160).optional(),
        partySize: z.number().int().min(1).max(99).optional(),
        notes: z.string().max(5000).optional(),
      }),
    )
    .mutation(({ ctx, input }) => updateBookingDetails({ ...input, actorUserId: ctx.user.userId })),

  /** Bring back what Hosthub says for one changed field. */
  resetField: operatorProcedure
    .input(
      z.object({
        bookingId: z.string().min(1),
        field: z.enum(EDITABLE_FIELDS),
        expectedVersion: z.number().int().nonnegative(),
      }),
    )
    .mutation(({ ctx, input }) => resetBookingField({ ...input, actorUserId: ctx.user.userId })),

  /** The last changes to this booking, newest first. */
  history: userProcedure
    .input(z.object({ bookingId: z.string().min(1) }))
    .query(({ input }) => bookingHistory(input.bookingId)),
});

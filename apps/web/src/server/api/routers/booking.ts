import { z } from "zod";
import { getBookingDetails } from "@/server/useCases/bookingDetails";
import { bookingSuggestions } from "@/server/useCases/bookingSuggestions";
import { moveBooking } from "@/server/useCases/moveBooking";
import { createTRPCRouter, operatorProcedure, userProcedure } from "../trpc";

export const bookingRouter = createTRPCRouter({
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
  details: userProcedure
    .input(z.object({ bookingId: z.string().min(1) }))
    .query(({ input }) => getBookingDetails(input.bookingId)),

  /** Every apartment for this booking, best first, with reasons. */
  suggestions: userProcedure
    .input(z.object({ bookingId: z.string().min(1) }))
    .query(({ input }) => bookingSuggestions(input.bookingId)),
});

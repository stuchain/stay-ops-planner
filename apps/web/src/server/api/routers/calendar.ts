import { isIsoDate, daysBetween, type IsoDate } from "@stay-ops/domain";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { applyArrangement, proposeArrangement } from "@/server/useCases/arrangeMonth";
import { getCalendarRange } from "@/server/useCases/calendarRange";
import { createTRPCRouter, operatorProcedure, userProcedure } from "../trpc";

const isoDateInput = z
  .string()
  .refine(isIsoDate, "Not a calendar date")
  .transform((s) => s as IsoDate);

/** At most about a year per request, so one call never loads everything. */
const MAX_RANGE_DAYS = 400;

export const calendarRouter = createTRPCRouter({
  range: userProcedure
    .input(
      z
        .object({ from: isoDateInput, to: isoDateInput })
        .refine(({ from, to }) => to > from && daysBetween(from, to) <= MAX_RANGE_DAYS, "Bad range"),
    )
    .query(async ({ ctx, input }) => {
      // Nightly prices are a Dev mode extra: only for an admin who switched Dev mode on.
      const withPrices =
        ctx.user.role === "admin" &&
        Boolean((await prisma.user.findUnique({ where: { id: ctx.user.userId }, select: { devMode: true } }))?.devMode);
      return getCalendarRange(input.from, input.to, new Date(), { withPrices });
    }),

  /** "Τακτοποίησε τον μήνα": where the planner would put every booking of the month that needs an apartment. */
  arrangePreview: operatorProcedure
    .input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }))
    .query(({ input }) => proposeArrangement(input.month)),

  /** Apply the preview as shown, all or nothing. */
  arrangeApply: operatorProcedure
    .input(
      z.object({
        placements: z
          .array(
            z.object({
              bookingId: z.string().min(1),
              roomId: z.string().min(1),
              expectedVersion: z.number().int().nonnegative(),
            }),
          )
          .max(200),
      }),
    )
    .mutation(({ ctx, input }) => applyArrangement({ ...input, actorUserId: ctx.user.userId })),
});

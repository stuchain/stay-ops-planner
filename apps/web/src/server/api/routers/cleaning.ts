import { addDays, isIsoDate, type IsoDate } from "@stay-ops/domain";
import { z } from "zod";
import { todayIso } from "@/server/time";
import { createCleanerToken } from "@/server/useCases/cleaningLink";
import {
  loadTurnovers,
  rescheduleTurnover,
  SCHEDULE_PAGE_DAYS,
  setTurnoverAssignee,
  setTurnoverStatus,
} from "@/server/useCases/cleaningSchedule";
import { createTRPCRouter, operatorProcedure, userProcedure } from "../trpc";

const day = z
  .string()
  .refine(isIsoDate, "Not a calendar date")
  .transform((s) => s as IsoDate);

/** What every change carries: which cleaning, and the `version` the person was looking at. */
const change = { id: z.string().min(1), expectedVersion: z.string().min(1) };

export const cleaningRouter = createTRPCRouter({
  /** A week of cleanings: page 0 starts today, page 1 a week later. Who leaves and who arrives next come with it. */
  list: userProcedure
    .input(z.object({ page: z.number().int().min(0).max(104), showCancelled: z.boolean().optional() }))
    .query(({ input }) =>
      loadTurnovers(addDays(todayIso(), input.page * SCHEDULE_PAGE_DAYS), SCHEDULE_PAGE_DAYS, {
        includeCancelled: input.showCancelled ?? false,
      }),
    ),

  /** To do, started or done. */
  setStatus: operatorProcedure
    .input(z.object({ ...change, status: z.enum(["todo", "in_progress", "done"]) }))
    .mutation(({ ctx, input }) => setTurnoverStatus({ ...input, actorUserId: ctx.user.userId })),

  /** Who cleans; empty clears it. */
  setAssignee: operatorProcedure
    .input(z.object({ ...change, assigneeName: z.string().max(80).nullable() }))
    .mutation(({ ctx, input }) => setTurnoverAssignee({ ...input, actorUserId: ctx.user.userId })),

  /** New times on the same day. */
  reschedule: operatorProcedure
    .input(z.object({ ...change, start: z.string().length(5), end: z.string().length(5) }))
    .mutation(({ ctx, input }) => rescheduleTurnover({ ...input, actorUserId: ctx.user.userId })),

  /** A signed read-only link for one day, to send to the cleaner. */
  createLink: operatorProcedure.input(z.object({ day })).mutation(({ input }) => {
    const { token, expiresAt } = createCleanerToken(input.day);
    return { path: `/c/${token}`, expiresAt: expiresAt.toISOString() };
  }),
});

import { isIsoDate, type IsoDate } from "@stay-ops/domain";
import { z } from "zod";
import { getTodaySummary } from "@/server/useCases/todaySummary";
import { getWeekSummary } from "@/server/useCases/weekSummary";
import { createTRPCRouter, userProcedure } from "../trpc";

export const todayRouter = createTRPCRouter({
  summary: userProcedure.query(() => getTodaySummary()),

  /** The weekly summary: arrivals, departures and cleanings from the Monday of `day` (this week when left out). */
  week: userProcedure
    .input(
      z.object({
        day: z
          .string()
          .refine(isIsoDate, "Not a calendar date")
          .transform((s) => s as IsoDate)
          .optional(),
        /** Start on `day` itself rather than its Monday. */
        startOnDay: z.boolean().optional(),
      }),
    )
    .query(({ input }) => getWeekSummary(input.day, undefined, undefined, input.startOnDay ? "day" : "monday")),
});

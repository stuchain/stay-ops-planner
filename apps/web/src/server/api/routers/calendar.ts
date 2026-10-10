import { isIsoDate, daysBetween, type IsoDate } from "@stay-ops/domain";
import { z } from "zod";
import { getCalendarRange } from "@/server/useCases/calendarRange";
import { createTRPCRouter, userProcedure } from "../trpc";

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
    .query(({ input }) => getCalendarRange(input.from, input.to)),
});

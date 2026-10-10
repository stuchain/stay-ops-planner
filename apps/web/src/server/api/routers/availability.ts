import { daysBetween, isIsoDate, type IsoDate } from "@stay-ops/domain";
import { z } from "zod";
import { checkAvailability } from "@/server/useCases/availability";
import { createTRPCRouter, userProcedure } from "../trpc";

const isoDateInput = z
  .string()
  .refine(isIsoDate, "Not a calendar date")
  .transform((s) => s as IsoDate);

const MAX_NIGHTS = 60;

export const availabilityRouter = createTRPCRouter({
  check: userProcedure
    .input(
      z
        .object({ checkin: isoDateInput, checkout: isoDateInput, guests: z.number().int().min(1).max(20).optional() })
        .refine(
          ({ checkin, checkout }) => checkout > checkin && daysBetween(checkin, checkout) <= MAX_NIGHTS,
          "Bad dates",
        ),
    )
    .query(({ input }) => checkAvailability(input.checkin, input.checkout, input.guests ?? null)),
});

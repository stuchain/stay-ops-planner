import { ReviewPlatform } from "@stay-ops/db";
import { z } from "zod";
import {
  addReviewSource,
  listReviews,
  recordReviewScore,
  refreshGoogleReviews,
  removeReviewSource,
} from "@/server/useCases/reviews";
import { buildStatistics } from "@/server/useCases/statistics";
import { createTRPCRouter, operatorProcedure } from "../trpc";

const year = z.number().int().min(2000).max(2100);
const id = z.string().min(1);

export const statsRouter = createTRPCRouter({
  /** Every statistic for a year against the one before; `toDate` cuts both at today's day. */
  year: operatorProcedure.input(z.object({ year, toDate: z.boolean() })).query(({ input }) => buildStatistics(input)),

  /** Review pages with their latest score and the ones to compare with. */
  reviews: operatorProcedure.input(z.object({ year })).query(({ input }) => listReviews(input.year)),

  addReviewSource: operatorProcedure
    .input(
      z.object({
        platform: z.nativeEnum(ReviewPlatform),
        url: z.string().trim().min(8).max(2000),
        label: z.string().trim().max(80).nullable(),
        roomId: id.nullable(),
      }),
    )
    .mutation(({ input }) => addReviewSource({ ...input, label: input.label ? input.label : null })),

  removeReviewSource: operatorProcedure.input(z.object({ id })).mutation(({ input }) => removeReviewSource(input.id)),

  /** The score and number of reviews a page shows today, typed in. */
  recordReviewScore: operatorProcedure
    .input(
      z.object({
        sourceId: id,
        rating: z.number().min(0).max(10).nullable(),
        count: z.number().int().min(0).max(1_000_000).nullable(),
      }),
    )
    .mutation(({ input }) => recordReviewScore(input)),

  /** Reads Google scores (once a day per page); does nothing without the server key. */
  refreshGoogle: operatorProcedure
    .input(z.object({ language: z.enum(["el", "en"]) }))
    .mutation(({ input }) => refreshGoogleReviews({ language: input.language })),
});

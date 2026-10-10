import { getTodaySummary } from "@/server/useCases/todaySummary";
import { createTRPCRouter, userProcedure } from "../trpc";

export const todayRouter = createTRPCRouter({
  summary: userProcedure.query(() => getTodaySummary()),
});

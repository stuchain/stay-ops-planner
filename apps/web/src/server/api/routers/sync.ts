import { getSyncStatus } from "@/server/useCases/syncStatus";
import { createTRPCRouter, userProcedure } from "../trpc";

export const syncRouter = createTRPCRouter({
  status: userProcedure.query(() => getSyncStatus()),
});

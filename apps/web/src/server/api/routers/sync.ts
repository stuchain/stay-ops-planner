import { runSyncNow } from "@/server/useCases/runSyncNow";
import { getSyncStatus } from "@/server/useCases/syncStatus";
import { createTRPCRouter, operatorProcedure, userProcedure } from "../trpc";

export const syncRouter = createTRPCRouter({
  status: userProcedure.query(() => getSyncStatus()),
  /** Runs a sync now and returns the result in a few plain outcomes. Operators and admins only. */
  run: operatorProcedure.mutation(() => runSyncNow()),
});

import { z } from "zod";
import { sendHelpRequest } from "@/server/useCases/helpRequest";
import { createTRPCRouter, userProcedure } from "../trpc";

export const helpRouter = createTRPCRouter({
  /** "Στείλε στον Στέλιο": any signed-in person can ask for help. */
  send: userProcedure
    .input(
      z.object({
        message: z.string().max(2000),
        page: z.string().max(500),
        lastError: z.object({ text: z.string().max(500), at: z.string().max(40) }).nullable(),
        sentryEventId: z.string().max(64).nullable(),
        userAgent: z.string().max(400),
        viewport: z.string().max(40),
        textSize: z.string().max(20).nullable(),
      }),
    )
    .mutation(({ ctx, input }) => sendHelpRequest({ ...input, actorUserId: ctx.user.userId })),
});

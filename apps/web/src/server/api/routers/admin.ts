import { z } from "zod";
import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { adminProcedure, createTRPCRouter } from "../trpc";

export const adminRouter = createTRPCRouter({
  /** Signs a user out on every device: their older sessions stop working at once. */
  signOutEverywhere: adminProcedure.input(z.object({ userId: z.string().min(1) })).mutation(async ({ input }) => {
    const found = await prisma.user.updateMany({
      where: { id: input.userId },
      data: { sessionVersion: { increment: 1 } },
    });
    if (found.count === 0) throw new DomainError("NOT_FOUND");
    return { ok: true as const };
  }),
});

import { z } from "zod";
import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { addFamilyMember, listFamily, setFamilyActive } from "@/server/useCases/family";
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

  /** Family sharing: read-only accounts that see who is coming, never money. */
  family: createTRPCRouter({
    list: adminProcedure.query(async () => ({ members: await listFamily() })),
    add: adminProcedure
      .input(
        z.object({
          email: z.string().trim().email().max(200),
          password: z.string().max(200),
          locale: z.enum(["el", "en"]),
        }),
      )
      .mutation(({ ctx, input }) => addFamilyMember({ ...input, actorUserId: ctx.user.userId })),
    setActive: adminProcedure
      .input(z.object({ userId: z.string().min(1), active: z.boolean() }))
      .mutation(({ ctx, input }) => setFamilyActive({ ...input, actorUserId: ctx.user.userId })),
  }),
});

import { z } from "zod";
import { listApartments, reorderApartments, updateApartment } from "@/server/useCases/apartments";
import { adminProcedure, createTRPCRouter } from "../trpc";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Dev mode (P2-5). Every procedure is admin-only on the server; the Dev mode switch only decides what is shown. */
export const devRouter = createTRPCRouter({
  apartments: createTRPCRouter({
    list: adminProcedure.query(() => listApartments()),

    update: adminProcedure
      .input(
        z.object({
          id: z.string().min(1),
          patch: z
            .object({
              name: z.string().trim().min(1).max(60),
              color: hexColor.nullable(),
              capacity: z.number().int().min(1).max(20).nullable(),
              preferredForLargeParty: z.boolean(),
              isActive: z.boolean(),
            })
            .partial(),
        }),
      )
      .mutation(({ ctx, input }) => updateApartment({ ...input, actorUserId: ctx.user.userId })),

    reorder: adminProcedure
      .input(z.object({ ids: z.array(z.string().min(1)).min(1) }))
      .mutation(({ ctx, input }) => reorderApartments({ ids: input.ids, actorUserId: ctx.user.userId })),
  }),
});

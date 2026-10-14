import { z } from "zod";
import { DomainError, isIsoDate, type IsoDate } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { applyPaperCalendar, previewPaperCalendar } from "@/server/useCases/paperCalendar";
import { addFamilyMember, listFamily, setFamilyActive } from "@/server/useCases/family";
import { adminProcedure, createTRPCRouter } from "../trpc";

const day = z
  .string()
  .refine(isIsoDate, "Expected YYYY-MM-DD")
  .transform((v) => v as IsoDate);

/** The Excel file as base64; the calendar file is well under 1 MB. */
const MAX_FILE_BASE64 = 6_000_000;

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

  /** Where past guests stayed, from the family's Excel calendar: preview first, then save what was ticked. */
  paperCalendar: createTRPCRouter({
    preview: adminProcedure
      .input(z.object({ fileBase64: z.string().min(1).max(MAX_FILE_BASE64) }))
      .mutation(({ input }) => previewPaperCalendar(Buffer.from(input.fileBase64, "base64"))),
    save: adminProcedure
      .input(
        z.object({
          items: z
            .array(
              z.object({
                bookingId: z.string().min(1),
                expectedVersion: z.number().int().nonnegative(),
                pieces: z
                  .array(z.object({ roomId: z.string().min(1), start: day, end: day }))
                  .min(1)
                  .max(20),
              }),
            )
            .max(1000),
        }),
      )
      .mutation(({ ctx, input }) => applyPaperCalendar(input.items, ctx.user.userId)),
  }),
});

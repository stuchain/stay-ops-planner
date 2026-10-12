import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { DomainError } from "@stay-ops/domain";
import { createCalendarFeed, getCalendarFeed, removeCalendarFeed } from "@/server/useCases/calendarFeed";
import { comparePassword, hashPassword, isAcceptablePasswordLength } from "@/modules/auth/password";
import { adminProcedure, createTRPCRouter, userProcedure } from "../trpc";

/** Text size choices, saved in `users.text_size`. */
export const TEXT_SIZES = ["normal", "large", "xlarge"] as const;

export const meRouter = createTRPCRouter({
  /** Who is signed in and how their screens should look. */
  get: userProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.user.userId },
      select: { email: true, role: true, uiLocale: true, devMode: true, textSize: true },
    });
    if (!user) throw new DomainError("UNAUTHORIZED");
    return {
      email: user.email,
      role: user.role,
      locale: user.uiLocale,
      devMode: user.devMode,
      textSize: user.textSize,
      /** When the login ends for good (12 hours after signing in), so the app can warn 5 minutes before. */
      sessionEndsAt: ctx.user.sessionEndsAt?.toISOString() ?? null,
    };
  }),

  /** Language and text size, per user. Only the fields sent are changed. */
  updatePreferences: userProcedure
    .input(z.object({ locale: z.enum(["el", "en"]).optional(), textSize: z.enum(TEXT_SIZES).optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = await prisma.user.update({
        where: { id: ctx.user.userId },
        data: {
          ...(input.locale ? { uiLocale: input.locale } : {}),
          ...(input.textSize ? { textSize: input.textSize } : {}),
        },
        select: { uiLocale: true, textSize: true },
      });
      return { locale: user.uiLocale, textSize: user.textSize };
    }),

  /** The signed-in user changes their own password; the current one must match. */
  changePassword: userProcedure
    .input(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = await prisma.user.findUnique({
        where: { id: ctx.user.userId },
        select: { passwordHash: true },
      });
      if (!user) throw new DomainError("UNAUTHORIZED");
      if (!(await comparePassword(input.currentPassword, user.passwordHash))) throw new DomainError("WRONG_PASSWORD");
      if (!isAcceptablePasswordLength(input.newPassword)) throw new DomainError("PASSWORD_TOO_SHORT");
      await prisma.user.update({
        where: { id: ctx.user.userId },
        data: { passwordHash: await hashPassword(input.newPassword) },
      });
      return { ok: true as const };
    }),

  /** The private phone calendar address of the signed-in user, or null when there is none. */
  calendarFeed: userProcedure.query(({ ctx }) => getCalendarFeed(ctx.user.userId)),

  /** Makes a new phone calendar address; the old one stops working. */
  createCalendarFeed: userProcedure.mutation(({ ctx }) => createCalendarFeed(ctx.user.userId)),

  /** Switches the phone calendar address off. */
  removeCalendarFeed: userProcedure.mutation(async ({ ctx }) => {
    await removeCalendarFeed(ctx.user.userId);
    return { ok: true as const };
  }),

  /** Dev mode switch. Admins only, checked on the server; it only saves the flag. */
  setDevMode: adminProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    const user = await prisma.user.update({
      where: { id: ctx.user.userId },
      data: { devMode: input.enabled },
      select: { devMode: true },
    });
    return { devMode: user.devMode };
  }),
});

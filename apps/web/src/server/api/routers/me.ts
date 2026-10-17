import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { DomainError } from "@stay-ops/domain";
import { createCalendarFeed, getCalendarFeed, removeCalendarFeed } from "@/server/useCases/calendarFeed";
import { comparePassword, hashPassword, isAcceptablePasswordLength } from "@/modules/auth/password";
import { createSessionToken, sessionSetCookieHeader } from "@/modules/auth/session";
import { adminProcedure, createTRPCRouter, operatorProcedure, userProcedure } from "../trpc";

/** Text size choices, saved in `users.text_size`. */
export const TEXT_SIZES = ["normal", "large", "xlarge"] as const;

/** Theme choices, saved in `users.theme`: light (default), dark, or follow the device. */
export const THEMES = ["light", "dark", "system"] as const;

export const meRouter = createTRPCRouter({
  /** Who is signed in and how their screens should look. */
  get: userProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.user.userId },
      select: { email: true, role: true, uiLocale: true, devMode: true, textSize: true, theme: true },
    });
    if (!user) throw new DomainError("UNAUTHORIZED");
    return {
      email: user.email,
      role: user.role,
      locale: user.uiLocale,
      devMode: user.devMode,
      textSize: user.textSize,
      theme: user.theme,
      /** When the login ends for good (12 hours after signing in), so the app can warn 5 minutes before. */
      sessionEndsAt: ctx.user.sessionEndsAt?.toISOString() ?? null,
    };
  }),

  /** Language, text size and theme, per user. Only the fields sent are changed. */
  updatePreferences: userProcedure
    .input(
      z.object({
        locale: z.enum(["el", "en"]).optional(),
        textSize: z.enum(TEXT_SIZES).optional(),
        theme: z.enum(THEMES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await prisma.user.update({
        where: { id: ctx.user.userId },
        data: {
          ...(input.locale ? { uiLocale: input.locale } : {}),
          ...(input.textSize ? { textSize: input.textSize } : {}),
          ...(input.theme ? { theme: input.theme } : {}),
        },
        select: { uiLocale: true, textSize: true, theme: true },
      });
      return { locale: user.uiLocale, textSize: user.textSize, theme: user.theme };
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
      // Every other signed-in device is signed out (in case the old password was known to someone else);
      // this browser gets a new session cookie so it stays signed in.
      const updated = await prisma.user.update({
        where: { id: ctx.user.userId },
        data: { passwordHash: await hashPassword(input.newPassword), sessionVersion: { increment: 1 } },
        select: { sessionVersion: true },
      });
      const { token, expiresAt } = createSessionToken(
        ctx.user.userId,
        ctx.user.role,
        Date.now(),
        updated.sessionVersion,
      );
      ctx.resHeaders?.append("Set-Cookie", sessionSetCookieHeader(token, expiresAt));
      return { ok: true as const };
    }),

  /**
   * The private phone calendar address of the signed-in user, or null when there is none.
   * Operators and admins only: the feed lists every guest with their phone.
   */
  calendarFeed: operatorProcedure.query(({ ctx }) => getCalendarFeed(ctx.user.userId)),

  /** Makes a new phone calendar address; the old one stops working. */
  createCalendarFeed: operatorProcedure.mutation(({ ctx }) => createCalendarFeed(ctx.user.userId)),

  /** Switches the phone calendar address off. */
  removeCalendarFeed: operatorProcedure.mutation(async ({ ctx }) => {
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

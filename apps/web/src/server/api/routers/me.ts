import { prisma } from "@/lib/prisma";
import { DomainError } from "@/server/errors";
import { userProcedure, createTRPCRouter } from "../trpc";
import { readFlags } from "@/server/flags";

export const meRouter = createTRPCRouter({
  /** Who is signed in and how their screens should look. */
  get: userProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.user.userId },
      select: { email: true, role: true, uiLocale: true, flags: true, devMode: true, textSize: true },
    });
    if (!user) throw new DomainError("UNAUTHORIZED");
    return {
      email: user.email,
      role: user.role,
      locale: user.uiLocale,
      flags: readFlags(user.flags),
      devMode: user.devMode,
      textSize: user.textSize,
    };
  }),
});

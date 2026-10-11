import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { verifyAndLoadAuthContext } from "@/modules/auth/guard";
import { SESSION_COOKIE_NAME } from "@/modules/auth/session";

export type UiLocale = "el" | "en";

/** Greek unless the user chose English. Signed-out pages (login) are Greek. */
export const DEFAULT_LOCALE: UiLocale = "el";

export type UserPreferences = {
  textSize: string;
  locale: UiLocale;
  /** Dev mode is shown: the user switched it on AND is an admin. It decides what is shown, never what is allowed. */
  devMode: boolean;
};

/**
 * Display settings for the signed-in user, read on the server; defaults when signed out.
 * Cached per request, so the layout and the translation config share one query.
 */
export const currentUserPreferences = cache(async (): Promise<UserPreferences> => {
  const cookieStore = await cookies();
  const ctx = await verifyAndLoadAuthContext(cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!ctx) return { textSize: "normal", locale: DEFAULT_LOCALE, devMode: false };
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { textSize: true, uiLocale: true, devMode: true },
  });
  return {
    textSize: user?.textSize ?? "normal",
    locale: user?.uiLocale === "en" ? "en" : DEFAULT_LOCALE,
    devMode: Boolean(user?.devMode) && ctx.role === "admin",
  };
});

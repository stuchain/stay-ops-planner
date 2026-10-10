import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { verifyAndLoadAuthContext } from "@/modules/auth/guard";
import { SESSION_COOKIE_NAME } from "@/modules/auth/session";

/** Per-user feature flags stored in `users.flags`. Unknown keys are ignored. */
export type UserFlags = {
  /** The redesigned app shell and Calendar (Phase 1B). Off until the new UI is accepted. */
  newUi: boolean;
};

const DEFAULT_FLAGS: UserFlags = { newUi: false };

export function readFlags(raw: unknown): UserFlags {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_FLAGS };
  const record = raw as Record<string, unknown>;
  return { newUi: record.newUi === true };
}

export type UiLocale = "el" | "en";

/** Greek unless the user chose English. Signed-out pages (login) are Greek. */
export const DEFAULT_LOCALE: UiLocale = "el";

export type UserPreferences = {
  flags: UserFlags;
  textSize: string;
  locale: UiLocale;
  /** Dev mode is shown: the user switched it on AND is an admin. It decides what is shown, never what is allowed. */
  devMode: boolean;
};

/**
 * Flags and display settings for the signed-in user, read on the server; defaults when signed out.
 * Cached per request, so the layout and the translation config share one query.
 */
export const currentUserPreferences = cache(async (): Promise<UserPreferences> => {
  const cookieStore = await cookies();
  const ctx = await verifyAndLoadAuthContext(cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!ctx) return { flags: { ...DEFAULT_FLAGS }, textSize: "normal", locale: DEFAULT_LOCALE, devMode: false };
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { flags: true, textSize: true, uiLocale: true, devMode: true },
  });
  return {
    flags: readFlags(user?.flags),
    textSize: user?.textSize ?? "normal",
    locale: user?.uiLocale === "en" ? "en" : DEFAULT_LOCALE,
    devMode: Boolean(user?.devMode) && ctx.role === "admin",
  };
});

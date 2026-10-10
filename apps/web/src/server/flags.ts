import { cookies } from "next/headers";
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

export type UserPreferences = { flags: UserFlags; textSize: string };

/** Flags and display settings for the signed-in user, read on the server; defaults when signed out. */
export async function currentUserPreferences(): Promise<UserPreferences> {
  const cookieStore = await cookies();
  const ctx = await verifyAndLoadAuthContext(cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!ctx) return { flags: { ...DEFAULT_FLAGS }, textSize: "normal" };
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { flags: true, textSize: true } });
  return { flags: readFlags(user?.flags), textSize: user?.textSize ?? "normal" };
}

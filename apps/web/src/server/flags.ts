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

/** Flags for the signed-in user, read on the server; defaults when signed out. */
export async function currentUserFlags(): Promise<UserFlags> {
  const cookieStore = await cookies();
  const ctx = await verifyAndLoadAuthContext(cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!ctx) return { ...DEFAULT_FLAGS };
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { flags: true } });
  return readFlags(user?.flags);
}

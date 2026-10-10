import { Prisma } from "@stay-ops/db";
import { writeAuditSnapshot } from "@stay-ops/audit";
import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { hashPassword, isAcceptablePasswordLength } from "@/modules/auth/password";
import { loginLockSeconds, unlockLogin } from "@/modules/auth/loginThrottle";
import { FLAG_KEYS, readFlags, type UserFlags } from "@/server/flags";

export type DevUserRow = {
  id: string;
  email: string;
  role: "viewer" | "operator" | "admin";
  isActive: boolean;
  locale: "el" | "en";
  /** ISO time of the last successful sign-in, when one is on record. */
  lastLoginAt: string | null;
  /** Seconds until the sign-in works again when too many wrong passwords blocked it; null when not blocked. */
  lockedForSeconds: number | null;
  flags: UserFlags;
};

const norm = (email: string) => email.trim().toLowerCase();

/** Every user, with what the admin needs to help them: last sign-in, lockout and flags. */
export async function listUsers(now = Date.now()): Promise<DevUserRow[]> {
  const users = await prisma.user.findMany({ orderBy: [{ role: "asc" }, { email: "asc" }] });
  const logins = await prisma.loginAttempt.groupBy({
    by: ["email"],
    where: { succeeded: true },
    _max: { createdAt: true },
  });
  const lastByEmail = new Map(logins.map((l) => [l.email, l._max.createdAt]));
  return Promise.all(
    users.map(async (u) => {
      const last = lastByEmail.get(norm(u.email)) ?? null;
      return {
        id: u.id,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        locale: u.uiLocale,
        lastLoginAt: last ? last.toISOString() : null,
        lockedForSeconds: await loginLockSeconds(norm(u.email), undefined, now),
        flags: readFlags(u.flags),
      };
    }),
  );
}

async function audit(args: { actorUserId: string; userId: string; action: string; before?: unknown; after?: unknown }) {
  await prisma.$transaction((tx) =>
    writeAuditSnapshot(tx, {
      actorUserId: args.actorUserId,
      entityType: "user",
      entityId: args.userId,
      action: args.action,
      before: args.before ?? {},
      after: args.after ?? {},
    }),
  );
}

async function requireUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new DomainError("NOT_FOUND");
  return user;
}

/** An admin sets a new password for any user. Other devices are signed out; the password is never written to the log. */
export async function setUserPassword(args: { actorUserId: string; userId: string; newPassword: string }) {
  const user = await requireUser(args.userId);
  if (!isAcceptablePasswordLength(args.newPassword)) throw new DomainError("PASSWORD_TOO_SHORT");
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(args.newPassword),
      ...(user.id === args.actorUserId ? {} : { sessionVersion: { increment: 1 } }),
    },
  });
  await audit({ actorUserId: args.actorUserId, userId: user.id, action: "user.password_set" });
  return { ok: true as const };
}

/** Lifts the sign-in block after wrong passwords. */
export async function unlockUser(args: { actorUserId: string; userId: string }) {
  const user = await requireUser(args.userId);
  const { cleared } = await unlockLogin(norm(user.email));
  await audit({ actorUserId: args.actorUserId, userId: user.id, action: "auth.login.unlocked", after: { cleared } });
  return { cleared };
}

export async function signOutUserEverywhere(args: { actorUserId: string; userId: string }) {
  const user = await requireUser(args.userId);
  await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
  await audit({ actorUserId: args.actorUserId, userId: user.id, action: "user.sign_out_everywhere" });
  return { ok: true as const };
}

/** Changes some of a user's flags; the others (and any unknown keys) stay as they are. */
export async function updateUserFlags(args: {
  actorUserId: string;
  userId: string;
  patch: { [K in keyof UserFlags]?: UserFlags[K] | undefined };
}) {
  const user = await requireUser(args.userId);
  const before = readFlags(user.flags);
  // An admin who switches the new UI off for themselves could not reach this page again.
  if (user.id === args.actorUserId && args.patch.newUi === false) throw new DomainError("VALIDATION");
  const stored =
    user.flags && typeof user.flags === "object" && !Array.isArray(user.flags)
      ? (user.flags as Record<string, unknown>)
      : {};
  const next: Record<string, unknown> = { ...stored };
  for (const key of FLAG_KEYS) {
    const value = args.patch[key];
    if (value !== undefined) next[key] = value;
  }
  await prisma.user.update({ where: { id: user.id }, data: { flags: next as Prisma.InputJsonValue } });
  const after = readFlags(next);
  await audit({ actorUserId: args.actorUserId, userId: user.id, action: "user.flags_update", before, after });
  return after;
}

import { writeAuditSnapshot } from "@stay-ops/audit";
import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { hashPassword, isAcceptablePasswordLength } from "@/modules/auth/password";
import { loginLockSeconds, unlockLogin } from "@/modules/auth/loginThrottle";
import { removeCalendarFeed } from "./calendarFeed";

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
};

const norm = (email: string) => email.trim().toLowerCase();

/** Every user, with what the admin needs to help them: last sign-in and lockout. */
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
  // The phone calendar address is a login of its own (it lists guests and phones): it stops too.
  await removeCalendarFeed(user.id);
  await audit({ actorUserId: args.actorUserId, userId: user.id, action: "user.sign_out_everywhere" });
  return { ok: true as const };
}

import { writeAuditSnapshot } from "@stay-ops/audit";
import { Prisma } from "@stay-ops/db";
import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { hashPassword, isAcceptablePasswordLength } from "@/modules/auth/password";

/**
 * Family sharing: read-only accounts (role `viewer`) for family members who only want to see who is coming.
 * They see Today, the calendar, the week, search and cleanings, never money, and cannot change anything.
 */
export type FamilyMember = {
  id: string;
  email: string;
  isActive: boolean;
  createdAt: string;
};

const norm = (email: string) => email.trim().toLowerCase();

export async function listFamily(): Promise<FamilyMember[]> {
  const rows = await prisma.user.findMany({
    where: { role: "viewer" },
    orderBy: [{ isActive: "desc" }, { email: "asc" }],
    select: { id: true, email: true, isActive: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

async function audit(actorUserId: string, userId: string, action: string, after: Record<string, unknown>) {
  await prisma.$transaction((tx) =>
    writeAuditSnapshot(tx, { actorUserId, entityType: "user", entityId: userId, action, before: {}, after }),
  );
}

/** Adds a family member with a password the admin gives them. The password is never logged. */
export async function addFamilyMember(args: {
  actorUserId: string;
  email: string;
  password: string;
  locale: "el" | "en";
}): Promise<FamilyMember> {
  const email = norm(args.email);
  if (!isAcceptablePasswordLength(args.password)) throw new DomainError("PASSWORD_TOO_SHORT");
  const taken = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (taken) throw new DomainError("EMAIL_TAKEN");
  try {
    const user = await prisma.user.create({
      data: { email, passwordHash: await hashPassword(args.password), role: "viewer", uiLocale: args.locale },
      select: { id: true, email: true, isActive: true, createdAt: true },
    });
    await audit(args.actorUserId, user.id, "user.family_added", { email, role: "viewer" });
    return { ...user, createdAt: user.createdAt.toISOString() };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      throw new DomainError("EMAIL_TAKEN");
    throw err;
  }
}

/** Turns a family member's access off (signed out at once) or back on. Only read-only accounts can be changed here. */
export async function setFamilyActive(args: { actorUserId: string; userId: string; active: boolean }) {
  const user = await prisma.user.findUnique({ where: { id: args.userId }, select: { role: true } });
  if (!user || user.role !== "viewer") throw new DomainError("NOT_FOUND");
  await prisma.user.update({
    where: { id: args.userId },
    data: { isActive: args.active, ...(args.active ? {} : { sessionVersion: { increment: 1 } }) },
  });
  await audit(args.actorUserId, args.userId, args.active ? "user.family_enabled" : "user.family_disabled", {
    isActive: args.active,
  });
  return { ok: true as const };
}

/**
 * Change one user's role (admin | operator | viewer). Prints the role before and after.
 *
 * Usage: SET_ROLE_EMAIL=you@example.com SET_ROLE=admin pnpm --filter @stay-ops/db run set-user-role
 * In production: the "Set user role" GitHub workflow (production environment secrets).
 */
import { PrismaClient } from "@prisma/client";

const email = process.env.SET_ROLE_EMAIL?.trim().toLowerCase() ?? "";
const role = process.env.SET_ROLE?.trim() ?? "";

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Set SET_ROLE_EMAIL to a valid email address.");
  process.exit(1);
}
if (!["admin", "operator", "viewer"].includes(role)) {
  console.error("Set SET_ROLE to admin, operator or viewer.");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
  const user = users.find((u) => u.email.trim().toLowerCase() === email);
  if (!user) {
    console.error("No user with that email.");
    process.exit(1);
  }
  console.log(`before: ${user.role}`);
  const after = await prisma.user.update({ where: { id: user.id }, data: { role }, select: { email: true, role: true } });
  console.log(`after: ${after.role}`);
} finally {
  await prisma.$disconnect();
}

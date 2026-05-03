/**
 * Upsert a user for local/staging use. Do not commit secrets.
 *
 * Usage (PowerShell):
 *   $env:CREATE_USER_EMAIL="you@example.com"
 *   $env:CREATE_USER_PASSWORD="your-secure-password"
 *   $env:CREATE_USER_ROLE="operator"   # optional: viewer | operator | admin (default operator)
 *   pnpm --filter @stay-ops/db run create-user
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });
config({ path: resolve(__dirname, "../../.env") });

const email = process.env.CREATE_USER_EMAIL?.trim().toLowerCase();
const password = process.env.CREATE_USER_PASSWORD ?? "";
const roleRaw = (process.env.CREATE_USER_ROLE ?? "operator").toLowerCase();

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Set CREATE_USER_EMAIL to a valid email address.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("CREATE_USER_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

const roleMap = {
  viewer: UserRole.viewer,
  operator: UserRole.operator,
  admin: UserRole.admin,
};
const role = roleMap[roleRaw];
if (!role) {
  console.error("CREATE_USER_ROLE must be one of: viewer, operator, admin.");
  process.exit(1);
}

const costRaw = process.env.BCRYPT_COST ?? process.env.BCRYPT_WORK_FACTOR ?? process.env.BCRYPT_ROUNDS;
const cost = costRaw ? Number(costRaw) : 12;
if (!Number.isFinite(cost) || cost < 4 || cost > 31) {
  console.error("BCRYPT_COST must be a number between 4 and 31.");
  process.exit(1);
}

const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash(password, cost);

try {
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, isActive: true, role },
    create: { email, passwordHash, isActive: true, role },
  });
  console.log(JSON.stringify({ ok: true, email, role: roleRaw }, null, 2));
} finally {
  await prisma.$disconnect();
}

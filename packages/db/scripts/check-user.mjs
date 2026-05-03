/**
 * Read-only: inspect a user row and recent failed login attempts (no writes).
 *
 * Usage (PowerShell):
 *   $env:CHECK_USER_EMAIL="you@example.com"
 *   pnpm --filter @stay-ops/db run check-user
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });
config({ path: resolve(__dirname, "../../.env") });

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_EMAIL_LIMIT = 5;

const raw = process.env.CHECK_USER_EMAIL?.trim();
const emailNorm = raw?.toLowerCase() ?? "";

if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
  console.error("Set CHECK_USER_EMAIL to a valid email address.");
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);

  const userRows = await prisma.$queryRaw`
    SELECT id, email, is_active, role::text as role, created_at, updated_at
    FROM users
    WHERE LOWER(TRIM(email)) = ${emailNorm}
    LIMIT 1
  `;

  const row = Array.isArray(userRows) ? userRows[0] : null;

  const [recentFailedAttempts, recentSample] = await Promise.all([
    prisma.loginAttempt.count({
      where: { email: emailNorm, succeeded: false, createdAt: { gte: since } },
    }),
    prisma.loginAttempt.findMany({
      where: { email: emailNorm, succeeded: false, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { createdAt: true, ip: true, succeeded: true },
    }),
  ]);

  const lockedOut = recentFailedAttempts >= LOGIN_EMAIL_LIMIT;

  if (!row) {
    console.log(
      JSON.stringify(
        {
          exists: false,
          emailNorm,
          recentFailedAttempts,
          lockedOut,
          recentFailedSample: recentSample.map((a) => ({
            createdAt: a.createdAt.toISOString(),
            ip: a.ip,
            succeeded: a.succeeded,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      JSON.stringify(
        {
          exists: true,
          emailNorm,
          user: {
            id: row.id,
            email: row.email,
            role: row.role,
            isActive: row.is_active,
            createdAt: row.created_at?.toISOString?.() ?? row.created_at,
            updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
          },
          isActive: row.is_active,
          role: row.role,
          recentFailedAttempts,
          lockedOut,
          recentFailedSample: recentSample.map((a) => ({
            createdAt: a.createdAt.toISOString(),
            ip: a.ip,
            succeeded: a.succeeded,
          })),
        },
        null,
        2,
      ),
    );
  }
} finally {
  await prisma.$disconnect();
}

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.APP_TIMEZONE ??= "Etc/UTC";

// Force integration tests onto a dedicated test database.
// Do not let tests default to the primary local dev DB.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://stayops:stayops@localhost:5432/stayops_test";

// `apps/web/src/lib/prisma.ts` caches a global PrismaClient; reset it so DATABASE_URL changes
// from other test files (or prior runs) cannot leave routes pointed at the wrong database.
const prismaGlobal = globalThis as unknown as { prisma?: unknown };
delete prismaGlobal.prisma;


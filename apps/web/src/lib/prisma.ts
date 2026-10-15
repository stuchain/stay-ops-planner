import { PrismaClient } from "@stay-ops/db";
import { withConnectTimeout } from "./databaseUrl";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const datasourceUrl = withConnectTimeout(process.env.DATABASE_URL);

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

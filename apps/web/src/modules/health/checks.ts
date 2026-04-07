import { PrismaClient } from "@stay-ops/db";

const prisma = new PrismaClient();

export async function checkDatabaseConnectivity(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

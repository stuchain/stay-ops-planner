import { PrismaClient } from "@stay-ops/db";

let prisma: PrismaClient | undefined;

export function getSyncPrisma(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

export async function disconnectSyncPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}

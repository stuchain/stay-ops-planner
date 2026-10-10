import { Prisma } from "@stay-ops/db";

const TRANSIENT_PRISMA_CODES = new Set<string>([
  "P2034", // transaction conflict / serialization
  "P2024", // pool timeout
  "P1001", // can't reach database server
  "P1002", // database server was reached but timed out
  "P1008", // operations timed out
  "P1017", // server closed the connection
]);

export function isTransientPrismaError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_PRISMA_CODES.has(err.code);
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("deadlock") ||
      msg.includes("serialization") ||
      msg.includes("could not serialize") ||
      msg.includes("restart transaction")
    );
  }
  return false;
}

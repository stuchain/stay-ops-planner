import { Prisma } from "@stay-ops/db";
import { defaultIsTransientError } from "@stay-ops/shared";
import { isRetryableHosthubError, type HosthubClientError } from "../hosthub/errors.js";

const TRANSIENT_PRISMA_CODES = new Set<string>([
  "P2034", // transaction conflict / serialization
  "P2024", // pool timeout
  "P1001", // can't reach database server
  "P1002", // database server was reached but timed out
  "P1008", // operations timed out
  "P1017", // server closed the connection
]);

export function pickPrismaErrorCode(err: unknown): string | undefined {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code;
  }
  return undefined;
}

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

function isHosthubClientErrorShape(err: unknown): err is HosthubClientError {
  if (!err || typeof err !== "object") return false;
  const o = err as { code?: unknown };
  return typeof o.code === "string";
}

export function isTransientHosthubError(err: unknown): boolean {
  if (!isHosthubClientErrorShape(err)) return false;
  return isRetryableHosthubError(err as HosthubClientError);
}

export function isTransientRedisOrNetworkError(err: unknown): boolean {
  if (defaultIsTransientError(err)) return true;
  if (err instanceof Error) {
    const m = err.message;
    if (/MaxRetriesPerRequest|READONLY|LOADING|ECONNREFUSED|ETIMEDOUT/i.test(m)) return true;
  }
  return false;
}

export function isTransientSyncError(err: unknown): boolean {
  return isTransientPrismaError(err) || isTransientHosthubError(err) || isTransientRedisOrNetworkError(err);
}

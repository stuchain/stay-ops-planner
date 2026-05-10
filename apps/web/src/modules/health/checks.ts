import { prisma } from "@/lib/prisma";

/** Outcome of a single readiness query (no secrets in this shape — safe on JSON probes). */
export type DbConnectivityResult =
  | { ok: true }
  | { ok: false; prismaCode?: string; issue?: DbConnectivityIssue };

export type DbConnectivityIssue =
  | "cannot_connect"
  | "connection_timeout"
  | "authentication_failed"
  | "database_does_not_exist"
  | "server_closed_connection"
  | "unknown";

/** Map common Prisma error codes to stable issue ids for dashboards and runbooks. */
function issueFromPrismaCode(code: string | undefined): DbConnectivityIssue | undefined {
  if (!code) return undefined;
  switch (code) {
    case "P1001":
      return "cannot_connect";
    case "P1002":
      return "connection_timeout";
    case "P1000":
      return "authentication_failed";
    case "P1003":
      return "database_does_not_exist";
    case "P1017":
      return "server_closed_connection";
    default:
      return code.startsWith("P") ? "unknown" : undefined;
  }
}

function prismaErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const o = error as Record<string, unknown>;
  const c = o.code ?? o.errorCode;
  return typeof c === "string" && c.length > 0 ? c : undefined;
}

function briefMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message).slice(0, 400);
  }
  return String(error).slice(0, 400);
}

export async function checkDatabaseConnectivity(): Promise<DbConnectivityResult> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error: unknown) {
    const prismaCode = prismaErrorCode(error);
    const issue = issueFromPrismaCode(prismaCode);
    console.warn(
      JSON.stringify({
        scope: "readiness_db_check",
        prismaCode: prismaCode ?? null,
        issue: issue ?? null,
      }),
      briefMessage(error),
    );
    return {
      ok: false,
      ...(prismaCode ? { prismaCode } : {}),
      ...(issue ? { issue } : {}),
    };
  }
}

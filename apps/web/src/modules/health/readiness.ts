import { NextResponse } from "next/server";
import { checkDatabaseConnectivity } from "./checks";

/** Readiness: process can serve traffic; database is reachable. */
export async function getReadinessResponse() {
  const startedAt = Date.now();
  const db = await checkDatabaseConnectivity();
  if (db.ok) {
    return NextResponse.json(
      {
        status: "ok",
        kind: "readiness",
        checks: { db: "ok" },
        uptimeSeconds: process.uptime(),
      },
      { status: 200 },
    );
  }

  const checks =
    db.prismaCode || db.issue
      ? {
          db: "error" as const,
          ...(db.prismaCode ? { prismaCode: db.prismaCode } : {}),
          ...(db.issue ? { issue: db.issue } : {}),
        }
      : { db: "error" as const };

  return NextResponse.json(
    {
      status: "degraded",
      kind: "readiness",
      checks,
      uptimeSeconds: process.uptime(),
      durationMs: Date.now() - startedAt,
    },
    { status: 503 },
  );
}

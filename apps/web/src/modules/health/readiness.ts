import { NextResponse } from "next/server";
import { checkDatabaseConnectivity } from "./checks";

/** Readiness: process can serve traffic; database is reachable. */
export async function getReadinessResponse() {
  const startedAt = Date.now();
  const dbOk = await checkDatabaseConnectivity();
  if (dbOk) {
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
  return NextResponse.json(
    {
      status: "degraded",
      kind: "readiness",
      checks: { db: "error" },
      uptimeSeconds: process.uptime(),
      durationMs: Date.now() - startedAt,
    },
    { status: 503 },
  );
}

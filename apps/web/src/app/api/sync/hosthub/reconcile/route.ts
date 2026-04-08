import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PrismaClient } from "@stay-ops/db";
import { runHosthubReconcile } from "@stay-ops/sync";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireSession } from "@/modules/auth/guard";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import { syncJsonError } from "@/modules/sync/errors";

const prisma = new PrismaClient();
const RECONCILE_LOCK_KEY = BigInt("848424015");

export async function POST(request: NextRequest) {
  try {
    requireSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  const token = await resolveHosthubApiToken();
  if (!token) {
    return NextResponse.json(
      syncJsonError("SERVICE_UNAVAILABLE", "Hosthub token is not configured"),
      { status: 503 },
    );
  }

  const running = await prisma.syncRun.findFirst({
    where: {
      source: "hosthub_poll",
      completedAt: null,
      startedAt: { gte: new Date(Date.now() - 2 * 60_000) },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });
  if (running) {
    return NextResponse.json(
      { data: { status: "running", runId: running.id, startedAt: running.startedAt.toISOString() } },
      { status: 202 },
    );
  }

  const lockRows = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(${RECONCILE_LOCK_KEY}) AS acquired
  `;
  const acquired = Boolean(lockRows[0]?.acquired);
  if (!acquired) {
    return NextResponse.json({ data: { status: "running" } }, { status: 202 });
  }

  try {
    await runHosthubReconcile(prisma, { apiToken: token });
    return NextResponse.json({ data: { status: "completed" } }, { status: 200 });
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${RECONCILE_LOCK_KEY})`;
  }
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runHosthubEnrichmentBackfill } from "@stay-ops/sync";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireSession } from "@/modules/auth/guard";
const BACKFILL_LOCK_KEY = BigInt("848424016");

const BodySchema = z.object({
  limit: z.number().int().min(1).max(50_000).optional(),
});

export async function POST(request: NextRequest) {
  try {
    requireSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()), {
      status: 400,
    });
  }

  const lockRows = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(${BACKFILL_LOCK_KEY}) AS acquired
  `;
  const acquired = Boolean(lockRows[0]?.acquired);
  if (!acquired) {
    return NextResponse.json({ data: { status: "running" } }, { status: 202 });
  }

  try {
    const result = await runHosthubEnrichmentBackfill(prisma, {
      limit: parsed.data.limit,
    });
    return NextResponse.json({ data: { status: "completed", result } }, { status: 200 });
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${BACKFILL_LOCK_KEY})`;
  }
}

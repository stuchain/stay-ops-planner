import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PrismaClient } from "@stay-ops/db";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireSession } from "@/modules/auth/guard";

const prisma = new PrismaClient();

/**
 * Recent sync runs for operators (no raw booking payloads).
 */
export async function GET(request: NextRequest) {
  try {
    requireSession(request);
    const runs = await prisma.syncRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
      select: {
        id: true,
        startedAt: true,
        completedAt: true,
        status: true,
        source: true,
        statsJson: true,
        cursor: true,
      },
    });
    return NextResponse.json({ data: { runs } }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), {
        status: err.status,
      });
    }
    throw err;
  }
}

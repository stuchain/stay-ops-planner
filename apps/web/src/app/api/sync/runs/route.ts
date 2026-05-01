import type { NextRequest } from "next/server";
import { respondAuthError } from "@/lib/apiError";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";

/**
 * Recent sync runs for operators (no raw booking payloads).
 */
export async function GET(request: NextRequest) {
  try {
    await requireOperatorOrAdmin(request);
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
      return respondAuthError(request, err);
    }
    throw err;
  }
}

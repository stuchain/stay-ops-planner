import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { writeAuditSnapshot } from "@stay-ops/audit";
import { apiError, respondAuthError } from "@/lib/apiError";
import { SYNC_USER_RATE_RULES, withRateLimit } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";
import { AuthError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";

async function postResetCursor(request: NextRequest): Promise<Response> {
  let ctx;
  try {
    ctx = await requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  try {
    const rowsUpdated = await prisma.$transaction(async (tx) => {
      const beforeCount = await tx.syncRun.count({
        where: { source: "hosthub_poll", cursor: { not: null } },
      });
      const res = await tx.syncRun.updateMany({
        where: { source: "hosthub_poll", cursor: { not: null } },
        data: { cursor: null },
      });
      await writeAuditSnapshot(tx, {
        actorUserId: ctx.userId,
        entityType: "sync_run",
        entityId: "*",
        action: "sync.hosthub.cursor_reset",
        before: { runsWithCursor: beforeCount },
        after: { runsWithCursor: 0 },
      });
      return res.count;
    });

    return NextResponse.json({ data: { reset: true, runsUpdated: rowsUpdated } });
  } catch (err) {
    return apiError(
      request,
      "INTERNAL_ERROR",
      "Internal server error",
      500,
      undefined,
      { route: "/api/admin/sync/hosthub/reset-cursor", method: "POST" },
      err,
    );
  }
}

export async function POST(request: NextRequest) {
  return withRateLimit("POST:/api/admin/sync/hosthub/reset-cursor", SYNC_USER_RATE_RULES, request, (req) =>
    postResetCursor(req as NextRequest),
  );
}

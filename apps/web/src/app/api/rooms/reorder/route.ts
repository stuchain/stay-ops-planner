import type { NextRequest } from "next/server";
import { respondAuthError } from "@/lib/apiError";
import { NextResponse } from "next/server";
import { writeAuditSnapshot } from "@stay-ops/audit";
import { fireInvalidateCalendarWideForRoomMetadata } from "@/lib/calendarMonthCacheInvalidate";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";

const BodySchema = z
  .object({
    orderedRoomIds: z.array(z.string().min(1)),
  })
  .strict();

export async function PATCH(request: NextRequest) {
  let session;
  try {
    session = await requireOperatorOrAdmin(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid request body"), { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()), {
      status: 400,
    });
  }

  const { orderedRoomIds } = parsed.data;
  const auditMeta = auditMetaFromRequest(request);

  try {
    await prisma.$transaction(async (tx) => {
      const activeRooms = await tx.room.findMany({
        where: { isActive: true },
        select: { id: true, calendarSortIndex: true },
        orderBy: [{ calendarSortIndex: "asc" }, { id: "asc" }],
      });
      const beforeIds = activeRooms.map((r) => r.id);
      const expectedIds = new Set(activeRooms.map((r) => r.id));
      const got = new Set(orderedRoomIds);

      if (expectedIds.size !== orderedRoomIds.length || [...expectedIds].some((id) => !got.has(id))) {
        throw Object.assign(new Error("INVALID_ORDER"), { code: "INVALID_ORDER" as const });
      }

      for (let i = 0; i < orderedRoomIds.length; i += 1) {
        const rid = orderedRoomIds[i]!;
        await tx.room.update({
          where: { id: rid },
          data: { calendarSortIndex: i },
        });
      }

      const afterRows = await tx.room.findMany({
        where: { isActive: true },
        select: { id: true, calendarSortIndex: true },
        orderBy: [{ calendarSortIndex: "asc" }, { id: "asc" }],
      });
      const afterIds = afterRows.map((r) => r.id);

      await writeAuditSnapshot(tx, {
        actorUserId: session.userId,
        action: "room_calendar_sort.reorder",
        entityType: "room_calendar_sort",
        entityId: "all_active_rooms",
        before: { roomIds: beforeIds },
        after: { roomIds: afterIds },
        meta: { ...auditMeta },
      });
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "INVALID_ORDER") {
      return NextResponse.json(
        jsonError("VALIDATION_ERROR", "orderedRoomIds must list every active room exactly once"),
        { status: 400 },
      );
    }
    throw err;
  }

  fireInvalidateCalendarWideForRoomMetadata();

  return NextResponse.json({ data: { ok: true } });
}

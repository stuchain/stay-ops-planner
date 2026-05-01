import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";

const BodySchema = z
  .object({
    orderedRoomIds: z.array(z.string().min(1)),
  })
  .strict();

export async function PATCH(request: NextRequest) {
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
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

  const activeRooms = await prisma.room.findMany({
    where: { isActive: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const expectedIds = new Set(activeRooms.map((r) => r.id));
  const got = new Set(orderedRoomIds);

  if (expectedIds.size !== orderedRoomIds.length || [...expectedIds].some((id) => !got.has(id))) {
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "orderedRoomIds must list every active room exactly once"),
      { status: 400 },
    );
  }

  await prisma.$transaction(
    orderedRoomIds.map((id, index) =>
      prisma.room.update({
        where: { id },
        data: { calendarSortIndex: index },
      }),
    ),
  );

  return NextResponse.json({ data: { ok: true } });
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { CleaningWindowInvalidError } from "@stay-ops/db";
import { CleaningBookingNotFoundError } from "@/modules/cleaning/errors";
import {
  createServiceCleaningTaskForApi,
  listCleaningTasks,
} from "@/modules/cleaning/taskSchedule";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";

const QuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assignee: z.string().optional(),
    status: z.string().optional(),
    roomId: z.string().optional(),
  })
  .strict();

const PostBodySchema = z
  .object({
    taskType: z.literal("service"),
    bookingId: z.string().min(1),
    roomId: z.string().min(1),
    sourceEventId: z.string().min(1).optional(),
    plannedStart: z.string().optional(),
  })
  .strict();

function taskDto(t: {
  id: string;
  bookingId: string;
  roomId: string;
  status: string | null;
  taskType: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  assigneeName: string | null;
  durationMinutes: number | null;
}) {
  return {
    id: t.id,
    bookingId: t.bookingId,
    roomId: t.roomId,
    status: t.status,
    taskType: t.taskType,
    plannedStart: t.plannedStart?.toISOString() ?? null,
    plannedEnd: t.plannedEnd?.toISOString() ?? null,
    assigneeName: t.assigneeName,
    durationMinutes: t.durationMinutes,
  };
}

export async function GET(request: NextRequest) {
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "Invalid query", parsed.error.flatten()),
      { status: 400 },
    );
  }

  const rows = await listCleaningTasks(parsed.data);
  return NextResponse.json({ data: { tasks: rows.map(taskDto) } });
}

export async function POST(request: NextRequest) {
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

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
      { status: 400 },
    );
  }

  let plannedStart: Date | undefined;
  if (parsed.data.plannedStart) {
    const d = new Date(parsed.data.plannedStart);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid plannedStart"), { status: 400 });
    }
    plannedStart = d;
  }

  try {
    const result = await createServiceCleaningTaskForApi({
      bookingId: parsed.data.bookingId,
      roomId: parsed.data.roomId,
      sourceEventId: parsed.data.sourceEventId,
      plannedStart,
    });
    return NextResponse.json(
      { data: { task: taskDto(result.task), created: result.created } },
      { status: result.created ? 201 : 200 },
    );
  } catch (err) {
    if (err instanceof CleaningBookingNotFoundError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status },
      );
    }
    if (err instanceof CleaningWindowInvalidError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status },
      );
    }
    throw err;
  }
}

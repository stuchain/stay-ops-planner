import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/modules/auth/guard";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { listOperationalThresholds, upsertOperationalThreshold } from "@/modules/admin-configuration/service";

const CreateThresholdSchema = z.object({
  key: z.enum([
    "unassigned_backlog_count",
    "unassigned_backlog_window_hours",
    "cleaning_overdue_minutes",
    "conflict_resolution_sla_minutes",
    "sync_failure_suppression_minutes",
  ]),
  numericValue: z.number().optional().nullable(),
  stringValue: z.string().max(500).optional().nullable(),
  unit: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  enabled: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  const data = await listOperationalThresholds();
  return NextResponse.json({ data }, { status: 200 });
}

export async function POST(request: NextRequest) {
  let sessionUserId = "";
  try {
    sessionUserId = requireAdminSession(request).userId;
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

  const parsed = CreateThresholdSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
      { status: 400 },
    );
  }

  const saved = await upsertOperationalThreshold({
    ...parsed.data,
    actorUserId: sessionUserId,
    auditMeta: auditMetaFromRequest(request),
  });
  return NextResponse.json({ data: saved }, { status: 201 });
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/modules/auth/guard";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { listAlertTemplates, upsertAlertTemplate } from "@/modules/admin-configuration/service";

const CreateTemplateSchema = z.object({
  eventType: z.enum([
    "sync_run_failed",
    "unassigned_backlog_threshold_reached",
    "cleaning_overdue",
    "conflict_resolution_required",
  ]),
  channel: z.enum(["whatsapp", "sms"]),
  templateVersion: z.number().int().positive().optional(),
  title: z.string().max(200).optional().nullable(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  metaJson: z.record(z.string(), z.unknown()).optional().nullable(),
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

  const data = await listAlertTemplates();
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

  const parsed = CreateTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
      { status: 400 },
    );
  }

  const saved = await upsertAlertTemplate({
    ...parsed.data,
    actorUserId: sessionUserId,
    auditMeta: auditMetaFromRequest(request),
  });
  return NextResponse.json({ data: saved }, { status: 201 });
}

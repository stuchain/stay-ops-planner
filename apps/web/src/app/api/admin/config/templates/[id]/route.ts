import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/modules/auth/guard";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { auditMetaFromRequest } from "@/modules/audit/requestMeta";
import { AdminConfigNotFoundError, updateAlertTemplateById } from "@/modules/admin-configuration/service";

const PatchTemplateSchema = z
  .object({
    title: z.string().max(200).optional().nullable(),
    body: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    metaJson: z.record(z.string(), z.unknown()).optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field required" });

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let sessionUserId = "";
  try {
    sessionUserId = requireAdminSession(request).userId;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid request body"), { status: 400 });
  }

  const parsed = PatchTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
      { status: 400 },
    );
  }

  try {
    const saved = await updateAlertTemplateById(id, {
      ...parsed.data,
      actorUserId: sessionUserId,
      auditMeta: auditMetaFromRequest(request),
    });
    return NextResponse.json({ data: saved }, { status: 200 });
  } catch (err) {
    if (err instanceof AdminConfigNotFoundError) {
      return NextResponse.json(jsonError(err.code, err.message, { id: err.id, entity: err.entity }), {
        status: err.status,
      });
    }
    throw err;
  }
}

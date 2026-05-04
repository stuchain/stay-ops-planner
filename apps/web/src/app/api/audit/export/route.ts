import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, attachTraceToResponse, respondAuthError } from "@/lib/apiError";
import { AuthError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import {
  AUDIT_EXPORT_MAX_EVENTS,
  auditExportRangeError,
  iterateAuditEventsForExport,
} from "@/modules/audit/queries";
import {
  AuditEventsQuerySchema,
  defaultAuditFrom,
  defaultAuditTo,
} from "@/modules/audit/listQueryParams";

const ExportQuerySchema = AuditEventsQuerySchema.extend({
  format: z.enum(["ndjson"]).optional(),
});

function exportFilename(from: Date, to: Date): string {
  const a = from.toISOString().slice(0, 10);
  const b = to.toISOString().slice(0, 10);
  return `audit-export-${a}_${b}.ndjson`;
}

export async function GET(request: NextRequest) {
  try {
    await requireOperatorOrAdmin(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  const url = new URL(request.url);
  const parsed = ExportQuerySchema.safeParse({
    entityType: url.searchParams.get("entityType") || undefined,
    bookingId: url.searchParams.get("bookingId") || undefined,
    roomId: url.searchParams.get("roomId") || undefined,
    actorUserId: url.searchParams.get("actorUserId") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    format: url.searchParams.get("format") || undefined,
  });
  if (!parsed.success) {
    return attachTraceToResponse(
      request,
      apiError(request, "VALIDATION_ERROR", "Invalid query", 400, parsed.error.flatten()),
    );
  }

  const from = parsed.data.from ?? defaultAuditFrom();
  const to = parsed.data.to ?? defaultAuditTo();
  const rangeErr = auditExportRangeError(from, to);
  if (rangeErr) {
    return attachTraceToResponse(request, apiError(request, "VALIDATION_ERROR", rangeErr, 422));
  }

  const filters = {
    entityType: parsed.data.entityType,
    bookingId: parsed.data.bookingId,
    roomId: parsed.data.roomId,
    actorUserId: parsed.data.actorUserId,
    from,
    to,
  };

  const header = {
    type: "audit_export_header" as const,
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    filters: {
      entityType: filters.entityType ?? null,
      bookingId: filters.bookingId ?? null,
      roomId: filters.roomId ?? null,
      actorUserId: filters.actorUserId ?? null,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    },
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`${JSON.stringify(header)}\n`));
        let emitted = 0;
        for await (const batch of iterateAuditEventsForExport(filters, { maxEvents: AUDIT_EXPORT_MAX_EVENTS })) {
          for (const row of batch) {
            if (emitted >= AUDIT_EXPORT_MAX_EVENTS) {
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(`${JSON.stringify(row)}\n`));
            emitted += 1;
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  const res = new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="${exportFilename(from, to)}"`,
      "Cache-Control": "no-store",
    },
  });
  return attachTraceToResponse(request, res);
}

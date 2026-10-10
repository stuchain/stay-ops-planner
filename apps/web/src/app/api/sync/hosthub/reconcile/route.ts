import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { AuthError } from "@/modules/auth/errors";
import { requireAnyRole, requireSession } from "@/modules/auth/guard";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import { syncJsonError } from "@/modules/sync/errors";
import { hosthubSource } from "@/server/sync/hosthubSource";
import { syncHosthub } from "@/server/useCases/syncHosthub";

export const maxDuration = 300;

const HEARTBEAT_TRIGGER = "heartbeat";

function readSyncTrigger(request: NextRequest): string | null {
  const v = request.headers.get("x-stayops-sync-trigger")?.trim().toLowerCase();
  return v && v.length > 0 ? v : null;
}

class DryRunNotSupported extends Error {}

async function parseFullSync(request: NextRequest): Promise<boolean> {
  if (request.nextUrl.searchParams.has("dryRun")) throw new DryRunNotSupported();
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return false;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("INVALID_JSON");
  }
  const o = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if ("dryRun" in o) throw new DryRunNotSupported();
  return Boolean(o.fullSync);
}

async function postHosthubReconcile(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(request, err.code, err.message, err.status, err.details);
    }
    throw err;
  }

  let fullSync = false;
  try {
    fullSync = await parseFullSync(request);
  } catch (err) {
    if (err instanceof DryRunNotSupported) {
      return apiError(request, "VALIDATION_ERROR", "dryRun is no longer supported", 400);
    }
    return apiError(request, "VALIDATION_ERROR", "Invalid request body", 400);
  }

  try {
    // Full sync re-fetches all history from Hosthub, so it is admin-only; everything else is operator or admin.
    if (fullSync) {
      requireAnyRole(ctx, ["admin"]);
    } else {
      requireAnyRole(ctx, ["operator", "admin"]);
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(request, err.code, err.message, err.status, err.details);
    }
    throw err;
  }

  const token = await resolveHosthubApiToken();
  if (!token) {
    const tid = readTraceId(request) || newTraceId();
    return attachTraceToResponse(
      request,
      NextResponse.json(syncJsonError("SERVICE_UNAVAILABLE", "Hosthub token is not configured", undefined, tid), {
        status: 503,
      }),
      tid,
    );
  }

  const traceId = readTraceId(request) || undefined;

  const trigger = readSyncTrigger(request) === HEARTBEAT_TRIGGER ? "open" : "manual";
  const result = await syncHosthub({ source: hosthubSource(token), trigger, full: fullSync });
  if (result.status === "skipped" && result.reason === "locked") {
    return attachTraceToResponse(request, apiError(request, "SYNC_ALREADY_RUNNING", "sync already running", 409));
  }
  if (result.status === "skipped") {
    return attachTraceToResponse(
      request,
      NextResponse.json({ data: { status: "skipped", reason: result.reason } }, { status: 200 }),
    );
  }
  return attachTraceToResponse(
    request,
    NextResponse.json({ data: { status: "completed", fullSync, stats: result.stats } }, { status: 200 }),
    traceId,
  );
}

export const POST = postHosthubReconcile;

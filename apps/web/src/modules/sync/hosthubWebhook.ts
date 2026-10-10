import { NextResponse } from "next/server";
import { Prisma } from "@stay-ops/db";
import { attachTraceToResponse } from "@/lib/apiError";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { prisma } from "@/lib/prisma";
import { log } from "@stay-ops/shared";
import {
  computeWebhookDedupeKey,
  extractHosthubReservationDto,
  HOSTHUB_WEBHOOK_SIGNATURE_HEADER,
  parseHosthubWebhookJson,
  sha256HexUtf8,
  verifyHosthubWebhookSignature,
} from "@stay-ops/sync";
import { applyHosthubBooking } from "@/server/sync/applyBooking";
import { syncJsonError } from "./errors";

function isDevelopmentRuntime(): boolean {
  return process.env.NODE_ENV === "development";
}

export async function handleHosthubWebhookPost(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const webhookSecret = process.env.WEBHOOK_SECRET?.trim();
  const isDev = isDevelopmentRuntime();

  if (!isDev) {
    if (!webhookSecret) {
      const tid = readTraceId(request) || newTraceId();
      return attachTraceToResponse(
        request,
        NextResponse.json(
          syncJsonError(
            "WEBHOOK_NOT_CONFIGURED",
            "Webhook secret is not configured for this environment",
            undefined,
            tid,
          ),
          { status: 503 },
        ),
        tid,
      );
    }
    const headerName =
      process.env.HOSTHUB_WEBHOOK_SIGNATURE_HEADER?.trim() || HOSTHUB_WEBHOOK_SIGNATURE_HEADER;
    const sig = request.headers.get(headerName);
    if (!verifyHosthubWebhookSignature(rawBody, webhookSecret, sig)) {
      const tid = readTraceId(request) || newTraceId();
      return attachTraceToResponse(
        request,
        NextResponse.json(
          syncJsonError("WEBHOOK_INVALID_SIGNATURE", "Invalid or missing webhook signature", undefined, tid),
          { status: 401 },
        ),
        tid,
      );
    }
  } else if (webhookSecret) {
    const headerName =
      process.env.HOSTHUB_WEBHOOK_SIGNATURE_HEADER?.trim() || HOSTHUB_WEBHOOK_SIGNATURE_HEADER;
    const sig = request.headers.get(headerName);
    if (!verifyHosthubWebhookSignature(rawBody, webhookSecret, sig)) {
      const tid = readTraceId(request) || newTraceId();
      return attachTraceToResponse(
        request,
        NextResponse.json(
          syncJsonError("WEBHOOK_INVALID_SIGNATURE", "Invalid or missing webhook signature", undefined, tid),
          { status: 401 },
        ),
        tid,
      );
    }
  }

  const parsedJson = parseHosthubWebhookJson(rawBody);
  if (!parsedJson.ok) {
    const tid = readTraceId(request) || newTraceId();
    return attachTraceToResponse(
      request,
      NextResponse.json(syncJsonError("INVALID_PAYLOAD", "Body must be valid JSON", undefined, tid), {
        status: 400,
      }),
      tid,
    );
  }

  const dedupeKey = computeWebhookDedupeKey(parsedJson.value, rawBody);
  const payloadHash = sha256HexUtf8(rawBody);

  return applyWebhookInRequest(request, parsedJson.value, dedupeKey, payloadHash);
}

/**
 * Apply the reservation inside this request, and only then mark the delivery as seen (keyed by a
 * hash of the body, so a newer delivery for the same event is applied). If applying fails, answer
 * 500 without marking it, so Hosthub sends it again.
 */
async function applyWebhookInRequest(
  request: Request,
  payload: unknown,
  dedupeKey: string,
  payloadHash: string,
): Promise<Response> {
  const accepted = () =>
    attachTraceToResponse(request, NextResponse.json({ data: { accepted: true, dedupeKey } }, { status: 200 }));

  const seen = await prisma.webhookInboundEvent.findUnique({ where: { dedupeKey }, select: { id: true } });
  if (seen) return accepted();

  const dto = extractHosthubReservationDto(payload);
  if (dto) {
    try {
      await prisma.$transaction((tx) => applyHosthubBooking(tx, { dto, raw: payload }));
    } catch (e) {
      const tid = readTraceId(request) || newTraceId();
      log("error", "hosthub_webhook_apply_failed", {
        dedupeKey,
        traceId: tid,
        err: e instanceof Error ? e.message : String(e),
      });
      return attachTraceToResponse(
        request,
        NextResponse.json(syncJsonError("INTERNAL_ERROR", "Could not apply webhook event", undefined, tid), {
          status: 500,
        }),
        tid,
      );
    }
  } else {
    // Not a reservation event we understand; retrying would not help.
    log("warn", "hosthub_webhook_no_reservation", { dedupeKey });
  }

  try {
    await prisma.webhookInboundEvent.create({ data: { provider: "hosthub", dedupeKey, payloadHash } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  return accepted();
}

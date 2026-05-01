import { NextResponse } from "next/server";
import { Prisma } from "@stay-ops/db";
import { attachTraceToResponse } from "@/lib/apiError";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { prisma } from "@/lib/prisma";
import {
  computeWebhookDedupeKey,
  enqueueHosthubInbound,
  HOSTHUB_WEBHOOK_SIGNATURE_HEADER,
  parseHosthubWebhookJson,
  sha256HexUtf8,
  verifyHosthubWebhookSignature,
} from "@stay-ops/sync";
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

  try {
    await prisma.webhookInboundEvent.create({
      data: {
        provider: "hosthub",
        dedupeKey,
        payloadHash,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return attachTraceToResponse(request, NextResponse.json({ data: { accepted: true, dedupeKey } }, { status: 200 }));
    }
    throw e;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl?.trim()) {
    await prisma.webhookInboundEvent.delete({ where: { dedupeKey } }).catch(() => undefined);
    const tid = readTraceId(request) || newTraceId();
    return attachTraceToResponse(
      request,
      NextResponse.json(
        syncJsonError("SERVICE_UNAVAILABLE", "Queue is not configured (REDIS_URL missing)", undefined, tid),
        { status: 503 },
      ),
      tid,
    );
  }

  try {
    await enqueueHosthubInbound(redisUrl.trim(), { dedupeKey, rawBody });
  } catch {
    await prisma.webhookInboundEvent.delete({ where: { dedupeKey } }).catch(() => undefined);
    const tid = readTraceId(request) || newTraceId();
    return attachTraceToResponse(
      request,
      NextResponse.json(
        syncJsonError("SERVICE_UNAVAILABLE", "Failed to enqueue sync job; try again later", undefined, tid),
        { status: 503 },
      ),
      tid,
    );
  }

  return attachTraceToResponse(request, NextResponse.json({ data: { accepted: true, dedupeKey } }, { status: 200 }));
}

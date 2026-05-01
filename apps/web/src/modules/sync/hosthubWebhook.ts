import { NextResponse } from "next/server";
import { Prisma } from "@stay-ops/db";
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

export async function handleHosthubWebhookPost(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (webhookSecret) {
    const headerName =
      process.env.HOSTHUB_WEBHOOK_SIGNATURE_HEADER?.trim() || HOSTHUB_WEBHOOK_SIGNATURE_HEADER;
    const sig = request.headers.get(headerName);
    if (!verifyHosthubWebhookSignature(rawBody, webhookSecret, sig)) {
      return NextResponse.json(
        syncJsonError("WEBHOOK_INVALID_SIGNATURE", "Invalid or missing webhook signature"),
        { status: 401 },
      );
    }
  }

  const parsedJson = parseHosthubWebhookJson(rawBody);
  if (!parsedJson.ok) {
    return NextResponse.json(syncJsonError("INVALID_PAYLOAD", "Body must be valid JSON"), {
      status: 400,
    });
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
      return NextResponse.json({ data: { accepted: true, dedupeKey } }, { status: 200 });
    }
    throw e;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl?.trim()) {
    await prisma.webhookInboundEvent.delete({ where: { dedupeKey } }).catch(() => undefined);
    return NextResponse.json(
      syncJsonError("SERVICE_UNAVAILABLE", "Queue is not configured (REDIS_URL missing)"),
      { status: 503 },
    );
  }

  try {
    await enqueueHosthubInbound(redisUrl.trim(), { dedupeKey, rawBody });
  } catch {
    await prisma.webhookInboundEvent.delete({ where: { dedupeKey } }).catch(() => undefined);
    return NextResponse.json(
      syncJsonError("SERVICE_UNAVAILABLE", "Failed to enqueue sync job; try again later"),
      { status: 503 },
    );
  }

  return NextResponse.json({ data: { accepted: true, dedupeKey } }, { status: 200 });
}

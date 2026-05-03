import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@stay-ops/db";
import { prisma } from "@/lib/prisma";
import { apiError, attachTraceToResponse } from "@/lib/apiError";
import { newTraceId, readTraceId } from "@/lib/traceId";
import { verifyAndLoadAuthContext } from "@/modules/auth/guard";
import { SESSION_COOKIE_NAME } from "@/modules/auth/session";

const IDEMPOTENCY_HEADER = "idempotency-key";
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_.:\-]{1,255}$/;
const TTL_MS = 24 * 60 * 60 * 1000;

function cloneRequestWithBody(request: NextRequest, rawBody: string, cookieHeader: string): NextRequest {
  const headers = new Headers(request.headers);
  if (cookieHeader.length > 0) {
    headers.set("cookie", cookieHeader);
  }
  const nextInit = {
    method: request.method,
    headers,
    body: rawBody.length > 0 ? rawBody : undefined,
    duplex: "half" as const,
    ...(request.signal != null ? { signal: request.signal } : {}),
  };
  return new NextRequest(request.url, nextInit as ConstructorParameters<typeof NextRequest>[1]);
}

/**
 * Stripe-style optional idempotency for POST bodies: first successful 2xx/4xx response is cached per
 * `(scope, Idempotency-Key, userId)` for 24h; replays return the same JSON. 5xx is never cached.
 */
export async function withIdempotency(
  scope: string,
  request: NextRequest,
  handler: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const rawHeader = request.headers.get("Idempotency-Key") ?? request.headers.get(IDEMPOTENCY_HEADER);
  if (!rawHeader?.trim()) {
    return handler(request);
  }

  const key = rawHeader.trim();
  if (!IDEMPOTENCY_KEY_REGEX.test(key)) {
    return apiError(request, "VALIDATION_ERROR", "Invalid Idempotency-Key header", 400);
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const ctx = await verifyAndLoadAuthContext(token);
  if (!ctx) {
    return handler(request);
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const rawBody = await request.text();
  const requestHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const expiresAt = new Date(Date.now() + TTL_MS);

  const replayRequest = () => cloneRequestWithBody(request, rawBody, cookieHeader);

  let reserved = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await prisma.idempotencyKey.create({
        data: {
          scope,
          key,
          userId: ctx.userId,
          requestHash,
          expiresAt,
        },
      });
      reserved = true;
      break;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") {
        throw e;
      }
      const row = await prisma.idempotencyKey.findUnique({
        where: { scope_key_userId: { scope, key, userId: ctx.userId } },
      });
      if (!row) {
        return apiError(request, "IDEMPOTENCY_KEY_CONFLICT", "Idempotency key conflict; retry", 409);
      }
      if (row.expiresAt <= new Date()) {
        await prisma.idempotencyKey.delete({ where: { id: row.id } });
        continue;
      }
      if (row.requestHash !== requestHash) {
        return apiError(
          request,
          "IDEMPOTENCY_KEY_CONFLICT",
          "Idempotency-Key reused with a different request body",
          422,
          { scope, key },
        );
      }
      if (row.responseBody === null) {
        const res = apiError(
          request,
          "IDEMPOTENCY_KEY_IN_PROGRESS",
          "Original request still in progress",
          409,
          { scope, key },
        );
        res.headers.set("Retry-After", "5");
        return res;
      }
      const replayed = NextResponse.json(row.responseBody as object, { status: row.statusCode ?? 200 });
      replayed.headers.set("idempotency-replayed", "true");
      return attachTraceToResponse(request, replayed);
    }
  }
  if (!reserved) {
    return apiError(request, "IDEMPOTENCY_KEY_CONFLICT", "Could not reserve idempotency key; retry", 409);
  }

  let response: Response;
  try {
    response = await handler(replayRequest());
  } catch (handlerErr) {
    await prisma.idempotencyKey.deleteMany({
      where: { scope, key, userId: ctx.userId },
    });
    throw handlerErr;
  }

  const status = response.status;
  const traceId = readTraceId(request) || newTraceId();

  if (status >= 500) {
    await prisma.idempotencyKey.deleteMany({
      where: { scope, key, userId: ctx.userId },
    });
    return attachTraceToResponse(request, response as NextResponse, traceId);
  }

  let responseBody: Prisma.InputJsonValue;
  try {
    responseBody = (await response.clone().json()) as Prisma.InputJsonValue;
  } catch {
    responseBody = { _nonJson: true } as Prisma.InputJsonValue;
  }

  await prisma.idempotencyKey.update({
    where: { scope_key_userId: { scope, key, userId: ctx.userId } },
    data: {
      statusCode: status,
      responseBody,
    },
  });

  return attachTraceToResponse(request, response as NextResponse, traceId);
}

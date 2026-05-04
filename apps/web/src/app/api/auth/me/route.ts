import { NextResponse } from "next/server";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { newTraceId, readTraceId, TRACE_HEADER } from "@/lib/traceId";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { getMeFromSessionToken, PatchMeBodySchema, patchMyUiLocale } from "@/modules/auth/service";
import { readCookieValue, SESSION_COOKIE_NAME } from "@/modules/auth/session";

export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const token = readCookieValue(cookieHeader, SESSION_COOKIE_NAME);
  const traceId = readTraceId(request) || newTraceId();

  if (!token) {
    const response = NextResponse.json(
      jsonError("UNAUTHORIZED", "Authentication required", undefined, traceId),
      { status: 401 },
    );
    response.headers.set(TRACE_HEADER, traceId);
    return response;
  }

  try {
    const me = await getMeFromSessionToken(token);
    return attachTraceToResponse(
      request,
      NextResponse.json(
        {
          data: {
            user: me.user,
            sessionExpiresAt: me.sessionExpiresAt,
          },
        },
        { status: 200 },
      ),
    );
  } catch (err) {
    if (err instanceof AuthError) {
      return attachTraceToResponse(
        request,
        NextResponse.json(jsonError(err.code, err.message, err.details, traceId), {
          status: err.status,
        }),
      );
    }
    return apiError(
      request,
      "INTERNAL_ERROR",
      "Internal server error",
      500,
      undefined,
      {
        route: "/api/auth/me",
        method: "GET",
      },
      err,
    );
  }
}

export async function PATCH(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const token = readCookieValue(cookieHeader, SESSION_COOKIE_NAME);
  const traceId = readTraceId(request) || newTraceId();

  if (!token) {
    const response = NextResponse.json(
      jsonError("UNAUTHORIZED", "Authentication required", undefined, traceId),
      { status: 401 },
    );
    response.headers.set(TRACE_HEADER, traceId);
    return response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return attachTraceToResponse(
      request,
      NextResponse.json(jsonError("BAD_REQUEST", "Invalid JSON body", undefined, traceId), { status: 400 }),
    );
  }

  const parsed = PatchMeBodySchema.safeParse(body);
  if (!parsed.success) {
    return attachTraceToResponse(
      request,
      NextResponse.json(
        jsonError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten(), traceId),
        { status: 400 },
      ),
    );
  }

  try {
    const me = await getMeFromSessionToken(token);
    await patchMyUiLocale(me.user.id, parsed.data.uiLocale);
    const refreshed = await getMeFromSessionToken(token);
    return attachTraceToResponse(
      request,
      NextResponse.json(
        {
          data: {
            user: refreshed.user,
            sessionExpiresAt: refreshed.sessionExpiresAt,
          },
        },
        { status: 200 },
      ),
    );
  } catch (err) {
    if (err instanceof AuthError) {
      return attachTraceToResponse(
        request,
        NextResponse.json(jsonError(err.code, err.message, err.details, traceId), {
          status: err.status,
        }),
      );
    }
    return apiError(
      request,
      "INTERNAL_ERROR",
      "Internal server error",
      500,
      undefined,
      {
        route: "/api/auth/me",
        method: "PATCH",
      },
      err,
    );
  }
}

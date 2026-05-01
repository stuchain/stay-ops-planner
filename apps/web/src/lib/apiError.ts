import { NextResponse as NextResponseCtor } from "next/server";
import type { NextResponse } from "next/server";
import { TRACE_HEADER, newTraceId, readTraceId } from "@/lib/traceId";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { log } from "@/lib/logger";
import type { ApiSentryMeta } from "@/lib/observability/sentryServer";
import * as Sentry from "@sentry/nextjs";
import { hashUserId } from "@stay-ops/shared/observability/hash-user-id";

type RequestLike = Pick<Request, "headers">;

export function attachTraceToResponse(
  request: RequestLike,
  response: NextResponse,
  traceIdOverride?: string,
): NextResponse {
  const id = traceIdOverride ?? (readTraceId(request) || newTraceId());
  response.headers.set(TRACE_HEADER, id);
  return response;
}

export function respondAuthError(request: RequestLike, err: AuthError): NextResponse {
  const traceId = readTraceId(request) || newTraceId();
  const res = NextResponseCtor.json(jsonError(err.code, err.message, err.details, traceId), {
    status: err.status,
  });
  res.headers.set(TRACE_HEADER, traceId);
  return res;
}

export function apiError(
  request: RequestLike,
  code: string,
  message: string,
  status: number,
  details?: unknown,
  sentryMeta?: ApiSentryMeta,
  /** Original error for Sentry stack traces (server 5xx only). */
  cause?: unknown,
): NextResponse {
  const traceId = readTraceId(request) || newTraceId();
  const res = NextResponseCtor.json(jsonError(code, message, details, traceId), { status });
  res.headers.set(TRACE_HEADER, traceId);
  if (status >= 500) {
    log("error", "api_error", { code, status, traceId, message });
    Sentry.withScope((scope) => {
      scope.setTag("trace_id", traceId);
      scope.setTag("http.status_code", String(status));
      if (sentryMeta?.route) scope.setTag("route", sentryMeta.route);
      if (sentryMeta?.method) scope.setTag("http.method", sentryMeta.method);
      if (sentryMeta?.userId) {
        scope.setUser({
          id: hashUserId(sentryMeta.userId, process.env.SENTRY_USER_ID_PEPPER),
        });
      }
      if (cause instanceof Error) {
        Sentry.captureException(cause);
      } else if (cause !== undefined && cause !== null) {
        Sentry.captureException(new Error(String(cause)));
      } else {
        Sentry.captureMessage(`${code}: ${message}`, "error");
      }
    });
  }
  return res;
}

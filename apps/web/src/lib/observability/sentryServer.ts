import * as Sentry from "@sentry/nextjs";
import { hashUserId } from "@stay-ops/shared/observability/hash-user-id";
import { newTraceId, readTraceId } from "@/lib/traceId";

export type ApiSentryMeta = {
  route?: string;
  method?: string;
  userId?: string | null;
};

export function captureApiException(
  err: unknown,
  request: Pick<Request, "headers">,
  meta: ApiSentryMeta,
): void {
  const traceId = readTraceId(request) || newTraceId();
  Sentry.withScope((scope) => {
    scope.setTag("trace_id", traceId);
    if (meta.route) scope.setTag("route", meta.route);
    if (meta.method) scope.setTag("http.method", meta.method);
    if (meta.userId) {
      scope.setUser({
        id: hashUserId(meta.userId, process.env.SENTRY_USER_ID_PEPPER),
      });
    }
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

export function captureApiHttpError(
  request: Pick<Request, "headers">,
  meta: ApiSentryMeta & { code: string; message: string; status: number },
): void {
  const traceId = readTraceId(request) || newTraceId();
  Sentry.withScope((scope) => {
    scope.setTag("trace_id", traceId);
    scope.setTag("http.status_code", String(meta.status));
    if (meta.route) scope.setTag("route", meta.route);
    if (meta.method) scope.setTag("http.method", meta.method);
    if (meta.userId) {
      scope.setUser({
        id: hashUserId(meta.userId, process.env.SENTRY_USER_ID_PEPPER),
      });
    }
    const level = meta.status >= 500 ? "error" : "warning";
    Sentry.captureMessage(`${meta.code}: ${meta.message}`, level);
  });
}

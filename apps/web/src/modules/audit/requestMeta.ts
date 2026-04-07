import type { NextRequest } from "next/server";

/** Correlation IDs from edge / proxies for audit `metaJson`. */
export function auditMetaFromRequest(request: NextRequest): Record<string, string> {
  const requestId =
    request.headers.get("x-request-id") ?? request.headers.get("x-vercel-id") ?? request.headers.get("cf-ray") ?? "";
  return requestId ? { requestId } : {};
}

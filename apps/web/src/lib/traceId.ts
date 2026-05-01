import { randomUUID } from "node:crypto";

/** Response + request header name for correlation (always server-generated in middleware). */
export const TRACE_HEADER = "x-request-id";

export function newTraceId(): string {
  return randomUUID();
}

export function readTraceId(request: Pick<Request, "headers">): string {
  return request.headers.get(TRACE_HEADER) ?? "";
}

const DEFAULT_NEXT_PATH = "/app";

/** Only follow same-site paths: a single leading "/" and not "//" or "/\\" (browsers treat those as other hosts). */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return DEFAULT_NEXT_PATH;
  }
  return next;
}

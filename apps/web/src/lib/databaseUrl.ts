/** Seconds Prisma waits to open a connection. Its default (5) is shorter than a Neon free database takes to wake up. */
export const CONNECT_TIMEOUT_SECONDS = 15;

/** Adds `connect_timeout` to a Postgres URL that has none, so the first request after Neon suspends waits instead of failing. */
export function withConnectTimeout(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("connect_timeout")) return url;
    parsed.searchParams.set("connect_timeout", String(CONNECT_TIMEOUT_SECONDS));
    return parsed.toString();
  } catch {
    return url;
  }
}

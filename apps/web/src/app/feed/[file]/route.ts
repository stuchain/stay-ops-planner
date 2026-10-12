import { after, type NextRequest } from "next/server";
import { buildCalendarFeed, refreshBeforeFeed, resolveCalendarFeedToken } from "@/server/useCases/calendarFeed";

/** Every fetch reads the bookings again; calendar apps decide how often they ask. */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How long a phone waits for new Hosthub bookings before it gets what is already stored. */
const SYNC_WAIT_MS = 8_000;

type Props = { params: Promise<{ file: string }> };

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  // The address is a secret: keep it out of search engines and out of any referrer.
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

/**
 * GET /feed/<token>.ics: the phone calendar feed (Settings > Ημερολόγιο στο κινητό). No session: the long
 * random token is the key. Outside /api and /app, so the middleware lets calendar apps through.
 */
export async function GET(_request: NextRequest, { params }: Props) {
  const { file } = await params;
  const owner = await resolveCalendarFeedToken(file.replace(/\.ics$/, ""));
  if (!owner) return new Response("Not found", { status: 404, headers: PRIVATE_HEADERS });

  const sync = refreshBeforeFeed();
  // A slow sync keeps running after the answer, so the phone's next fetch has it.
  after(() => sync);
  await Promise.race([sync, new Promise((resolve) => setTimeout(resolve, SYNC_WAIT_MS))]);

  const body = await buildCalendarFeed(owner.locale);
  return new Response(body, {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="stay-ops.ics"',
    },
  });
}

import { Prisma, ReviewPlatform } from "@stay-ops/db";
import { addDays, DomainError, type IsoDate } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import {
  fetchPlace,
  findPlaceId,
  googlePlacesKey,
  type Fetcher,
  type GoogleReview,
} from "@/server/reviews/googlePlaces";
import { dbDateToIso, isoToDbDate, todayIso } from "@/server/time";

/** The top of each platform's scale. */
export const RATING_SCALE: Record<ReviewPlatform, number> = { airbnb: 5, booking: 10, google: 5 };

const HOSTS: Record<ReviewPlatform, RegExp> = {
  airbnb: /(^|\.)airbnb\.[a-z.]+$/,
  booking: /(^|\.)booking\.com$/,
  google: /(^|\.)(google\.[a-z.]+|goo\.gl)$/,
};

export type ReviewPoint = {
  takenOn: IsoDate;
  /** On the platform's scale, two decimals. */
  rating: number | null;
  count: number | null;
};

export type ReviewSourceView = {
  id: string;
  platform: ReviewPlatform;
  url: string;
  label: string | null;
  roomId: string | null;
  scale: number;
  latest: (ReviewPoint & { origin: string }) | null;
  /** The last score known on or before the same day a year ago. */
  yearAgo: ReviewPoint | null;
  /** The last score known before 1 January of the year shown. */
  yearStart: ReviewPoint | null;
  /** Google only: the latest reviews it returned. */
  latestReviews: GoogleReview[];
};

export type ReviewsData = {
  /** Whether Google scores can be read automatically (the key is set on the server). */
  googleReady: boolean;
  sources: ReviewSourceView[];
};

const toPoint = (s: { takenOn: Date; ratingHundredths: number | null; reviewCount: number | null }): ReviewPoint => ({
  takenOn: dbDateToIso(s.takenOn),
  rating: s.ratingHundredths === null ? null : s.ratingHundredths / 100,
  count: s.reviewCount,
});

function reviewsOf(value: Prisma.JsonValue | null): GoogleReview[] {
  return Array.isArray(value) ? (value as unknown as GoogleReview[]) : [];
}

/** Review pages with their latest score and the scores to compare with, for `year`. */
export async function listReviews(
  year: number,
  today: IsoDate = todayIso(),
  db: typeof prisma = prisma,
): Promise<ReviewsData> {
  const sources = await db.reviewSource.findMany({
    orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
    include: { snapshots: { orderBy: { takenOn: "asc" } } },
  });
  const yearAgo = addDays(today, -365);
  const yearStart = `${year}-01-01`;
  return {
    googleReady: googlePlacesKey() !== null,
    sources: sources.map((s) => {
      const points = s.snapshots.map((p) => ({ ...toPoint(p), origin: p.origin, latestReviews: p.latestReviews }));
      const last = points.at(-1) ?? null;
      const before = (day: string, inclusive: boolean) =>
        [...points].reverse().find((p) => (inclusive ? p.takenOn <= day : p.takenOn < day)) ?? null;
      const ago = before(yearAgo, true);
      const start = before(yearStart, false);
      return {
        id: s.id,
        platform: s.platform,
        url: s.url,
        label: s.label,
        roomId: s.roomId,
        scale: RATING_SCALE[s.platform]!,
        latest: last ? { takenOn: last.takenOn, rating: last.rating, count: last.count, origin: last.origin } : null,
        yearAgo: ago ? { takenOn: ago.takenOn, rating: ago.rating, count: ago.count } : null,
        yearStart: start ? { takenOn: start.takenOn, rating: start.rating, count: start.count } : null,
        latestReviews:
          s.platform === "google"
            ? reviewsOf([...points].reverse().find((p) => p.latestReviews)?.latestReviews ?? null)
            : [],
      };
    }),
  };
}

/** The link must be on the platform's own site. */
export function checkReviewLink(platform: ReviewPlatform, link: string): string {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new DomainError("VALIDATION", { field: "url" });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new DomainError("VALIDATION", { field: "url" });
  if (!HOSTS[platform]!.test(url.hostname.toLowerCase())) throw new DomainError("VALIDATION", { field: "url" });
  return url.toString();
}

export async function addReviewSource(
  input: { platform: ReviewPlatform; url: string; label: string | null; roomId: string | null },
  db: typeof prisma = prisma,
): Promise<{ id: string }> {
  const url = checkReviewLink(input.platform, input.url);
  if (input.roomId) {
    const room = await db.room.findUnique({ where: { id: input.roomId }, select: { id: true } });
    if (!room) throw new DomainError("NOT_FOUND");
  }
  const created = await db.reviewSource.create({
    data: { platform: input.platform, url, label: input.label, roomId: input.roomId },
    select: { id: true },
  });
  return created;
}

export async function removeReviewSource(id: string, db: typeof prisma = prisma): Promise<void> {
  const { count } = await db.reviewSource.deleteMany({ where: { id } });
  if (count === 0) throw new DomainError("NOT_FOUND");
}

/** Saves the score a page shows today (typed in); a second save on the same day replaces it. */
export async function recordReviewScore(
  input: { sourceId: string; rating: number | null; count: number | null; today?: IsoDate },
  db: typeof prisma = prisma,
): Promise<void> {
  const source = await db.reviewSource.findUnique({ where: { id: input.sourceId }, select: { platform: true } });
  if (!source) throw new DomainError("NOT_FOUND");
  if (input.rating !== null && (input.rating < 0 || input.rating > RATING_SCALE[source.platform]!)) {
    throw new DomainError("VALIDATION", { field: "rating" });
  }
  if (input.rating === null && input.count === null) throw new DomainError("VALIDATION", { field: "rating" });
  const takenOn = isoToDbDate(input.today ?? todayIso());
  const data = {
    ratingHundredths: input.rating === null ? null : Math.round(input.rating * 100),
    reviewCount: input.count,
    origin: "manual",
  };
  await db.reviewSnapshot.upsert({
    where: { sourceId_takenOn: { sourceId: input.sourceId, takenOn } },
    create: { sourceId: input.sourceId, takenOn, ...data },
    update: { ...data, latestReviews: Prisma.DbNull },
  });
}

export type GoogleRefresh = { status: "no_key" | "done"; updated: number; failed: number };

/**
 * Reads every Google page's score once a day (a page already read today is skipped). A page whose
 * place cannot be found or read counts as failed and is tried again on the next call.
 */
export async function refreshGoogleReviews(
  opts: { today?: IsoDate; language?: string; fetcher?: Fetcher; key?: string | null } = {},
  db: typeof prisma = prisma,
): Promise<GoogleRefresh> {
  const key = opts.key === undefined ? googlePlacesKey() : opts.key;
  if (!key) return { status: "no_key", updated: 0, failed: 0 };
  const takenOn = isoToDbDate(opts.today ?? todayIso());
  const sources = await db.reviewSource.findMany({
    where: { platform: ReviewPlatform.google, snapshots: { none: { takenOn, origin: "google" } } },
  });
  let updated = 0;
  let failed = 0;
  for (const s of sources) {
    try {
      const placeId = s.googlePlaceId ?? (await findPlaceId(s.url, key, opts.fetcher));
      if (!placeId) {
        failed += 1;
        continue;
      }
      const place = await fetchPlace(placeId, key, opts.language ?? "el", opts.fetcher);
      if (s.googlePlaceId !== place.placeId) {
        await db.reviewSource.update({ where: { id: s.id }, data: { googlePlaceId: place.placeId } });
      }
      const data = {
        ratingHundredths: place.rating === null ? null : Math.round(place.rating * 100),
        reviewCount: place.reviewCount,
        origin: "google",
        latestReviews: place.reviews as unknown as Prisma.InputJsonValue,
      };
      await db.reviewSnapshot.upsert({
        where: { sourceId_takenOn: { sourceId: s.id, takenOn } },
        create: { sourceId: s.id, takenOn, ...data },
        update: data,
      });
      updated += 1;
    } catch {
      failed += 1;
    }
  }
  return { status: "done", updated, failed };
}

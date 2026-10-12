/**
 * Google Places API (New): the score, the number of reviews and the latest reviews (Google returns
 * up to five) of a place, found from a Google Maps link. Needs `GOOGLE_PLACES_API_KEY`.
 */

const API = "https://places.googleapis.com/v1";

export type GoogleReview = {
  author: string | null;
  /** 1–5. */
  rating: number | null;
  text: string | null;
  /** ISO time. */
  publishedAt: string | null;
};

export type GooglePlace = {
  placeId: string;
  name: string | null;
  rating: number | null;
  reviewCount: number | null;
  reviews: GoogleReview[];
};

export type Fetcher = typeof fetch;

export function googlePlacesKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.GOOGLE_PLACES_API_KEY?.trim();
  return key ? key : null;
}

/** What a Maps link says about the place: an explicit place id, or a name and a point to search near. */
export function parseMapsLink(link: string): { placeId?: string; query?: string; lat?: number; lng?: number } {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return {};
  }
  const placeId = url.searchParams.get("query_place_id") ?? url.searchParams.get("place_id");
  if (placeId) return { placeId };
  const out: { query?: string; lat?: number; lng?: number } = {};
  const place = /\/maps\/place\/([^/]+)/.exec(url.pathname);
  if (place?.[1]) out.query = decodeURIComponent(place[1].replace(/\+/g, " "));
  const q = url.searchParams.get("q") ?? url.searchParams.get("query");
  if (!out.query && q) out.query = q;
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url.pathname);
  if (at) {
    out.lat = Number(at[1]);
    out.lng = Number(at[2]);
  }
  return out;
}

/** Short links (maps.app.goo.gl, goo.gl/maps) lead to the full Maps link. */
async function expandLink(link: string, fetcher: Fetcher): Promise<string> {
  try {
    const host = new URL(link).hostname;
    if (!host.endsWith("goo.gl")) return link;
    const res = await fetcher(link, { redirect: "follow" });
    return res.url || link;
  } catch {
    return link;
  }
}

/** The Google place id a Maps link points to; null when it cannot be found. */
export async function findPlaceId(link: string, key: string, fetcher: Fetcher = fetch): Promise<string | null> {
  const parsed = parseMapsLink(await expandLink(link, fetcher));
  if (parsed.placeId) return parsed.placeId;
  if (!parsed.query) return null;
  const body: Record<string, unknown> = { textQuery: parsed.query, pageSize: 1 };
  if (parsed.lat !== undefined && parsed.lng !== undefined) {
    body.locationBias = { circle: { center: { latitude: parsed.lat, longitude: parsed.lng }, radius: 1000 } };
  }
  const res = await fetcher(`${API}/places:searchText`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google search failed (${res.status})`);
  const data = (await res.json()) as { places?: { id?: string }[] };
  return data.places?.[0]?.id ?? null;
}

type PlaceResponse = {
  id?: string;
  displayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  reviews?: {
    rating?: number;
    text?: { text?: string };
    originalText?: { text?: string };
    publishTime?: string;
    authorAttribution?: { displayName?: string };
  }[];
};

/** The place's score, count and latest reviews, in the user's language when Google has it. */
export async function fetchPlace(
  placeId: string,
  key: string,
  language: string,
  fetcher: Fetcher = fetch,
): Promise<GooglePlace> {
  const res = await fetcher(`${API}/places/${encodeURIComponent(placeId)}?languageCode=${language}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,displayName,rating,userRatingCount,reviews" },
  });
  if (!res.ok) throw new Error(`Google place failed (${res.status})`);
  const data = (await res.json()) as PlaceResponse;
  return {
    placeId: data.id ?? placeId,
    name: data.displayName?.text ?? null,
    rating: typeof data.rating === "number" ? data.rating : null,
    reviewCount: typeof data.userRatingCount === "number" ? data.userRatingCount : null,
    reviews: (data.reviews ?? []).map((r) => ({
      author: r.authorAttribution?.displayName ?? null,
      rating: typeof r.rating === "number" ? r.rating : null,
      text: r.originalText?.text ?? r.text?.text ?? null,
      publishedAt: r.publishTime ?? null,
    })),
  };
}

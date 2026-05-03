import { Channel } from "@stay-ops/db";

const DIRECT_WORD = /\bdirect\b/i;

/** Booking.com and close variants without matching "direct booking" style labels */
function isBookingComStrict(compact: string): boolean {
  return (
    compact.includes("bookingcom") ||
    compact.includes("bookingdotcom") ||
    compact.includes("bcom") ||
    compact === "booking" ||
    compact === "bookings"
  );
}

/** e.g. "Hotel booking" — uses word boundaries; run after direct/website rules */
function isBookingComLooseLabel(trimmed: string): boolean {
  return /\bbookings?\b/i.test(trimmed);
}

/**
 * Map free-text listing channel labels to persisted enum.
 * Unknown values default to `direct` (manual / other sources).
 */
export function mapHosthubListingChannel(listingChannel: string | undefined): Channel {
  const raw = listingChannel?.trim() ?? "";
  const s = raw.toLowerCase();
  const compact = s.replace(/[\s._-]+/g, "");
  if (compact.includes("airbnb")) return Channel.airbnb;
  // Before Booking.com heuristics: labels like "Direct booking" must not collapse into `booking`
  // (same `externalListingId` as real Booking.com → missing direct rows in source_listings).
  const directProbe = s.replace(/_/g, " ");
  if (DIRECT_WORD.test(directProbe)) return Channel.direct;
  if (isBookingComStrict(compact)) return Channel.booking;
  // Own-site channels (after strict Booking.com so "Booking.com website" stays booking)
  if (/\bwebsite\b/i.test(directProbe)) return Channel.direct;
  if (isBookingComLooseLabel(raw)) return Channel.booking;
  // Hosthub "direct" / own website / VRBO etc. — anything not Airbnb/Booking maps to `direct`.
  return Channel.direct;
}

import { Channel } from "@stay-ops/db";

/**
 * Map free-text listing channel labels to persisted enum.
 * Unknown values default to `direct` (manual / other sources).
 */
export function mapHosthubListingChannel(listingChannel: string | undefined): Channel {
  const s = listingChannel?.trim().toLowerCase() ?? "";
  const compact = s.replace(/[\s._-]+/g, "");
  if (compact.includes("airbnb")) return Channel.airbnb;
  if (
    compact.includes("booking") ||
    compact.includes("bookingcom") ||
    compact.includes("bookingdotcom") ||
    compact.includes("bcom")
  ) {
    return Channel.booking;
  }
  return Channel.direct;
}

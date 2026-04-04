import { Channel } from "@stay-ops/db";

/**
 * Map free-text listing channel labels to persisted enum.
 * Unknown values default to `direct` (manual / other sources).
 */
export function mapHosthubListingChannel(listingChannel: string | undefined): Channel {
  const s = listingChannel?.trim().toLowerCase() ?? "";
  if (s.includes("airbnb")) return Channel.airbnb;
  if (s.includes("booking")) return Channel.booking;
  return Channel.direct;
}

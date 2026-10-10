import type { ReasonCode } from "@stay-ops/domain";

/** Greek words for the calendar screen. English comes with the translation files in Phase 2. */
export const MONTHS_EL = [
  "Ιανουάριος",
  "Φεβρουάριος",
  "Μάρτιος",
  "Απρίλιος",
  "Μάιος",
  "Ιούνιος",
  "Ιούλιος",
  "Αύγουστος",
  "Σεπτέμβριος",
  "Οκτώβριος",
  "Νοέμβριος",
  "Δεκέμβριος",
] as const;

export const WEEKDAYS_EL = ["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"] as const;

/** The one reason shown next to the recommended apartment: "Προτείνεται: χωράει 4 άτομα". */
export function recommendationText(reasons: readonly ReasonCode[], partySize: number | null): string {
  if (reasons.includes("BOOKED_THIS_ROOM")) return "Προτείνεται: αυτό έκλεισε ο επισκέπτης";
  if (reasons.includes("LARGE_PARTY_ROOM") && partySize !== null) return `Προτείνεται: χωράει ${partySize} άτομα`;
  if (reasons.includes("FITS_PARTY") && partySize !== null) return `Προτείνεται: χωράει ${partySize} άτομα`;
  if (reasons.includes("NO_GAP")) return "Προτείνεται: δεν αφήνει κενή νύχτα";
  return "Προτείνεται";
}

export function capacityText(capacity: number | null): string {
  return capacity === null ? "χωρητικότητα δεν ορίστηκε" : `έως ${capacity} άτομα`;
}

export function smallRoomText(capacity: number): string {
  return `Μικρό: χωράει έως ${capacity} άτομα`;
}

export function partyText(partySize: number | null): string {
  if (partySize === null) return "Άγνωστος αριθμός ατόμων";
  return partySize === 1 ? "1 άτομο" : `${partySize} άτομα`;
}

export const CHANNEL_EL = { airbnb: "Airbnb", booking: "Booking.com", direct: "Απευθείας" } as const;

import type { ReasonCode } from "@stay-ops/domain";

type RecommendationKey = "recommendedBooked" | "recommendedFits" | "recommendedNoGap" | "recommended";

/** The `booking` messages this needs; `useTranslations("booking")` fits. */
export type RecommendationTranslate = (key: RecommendationKey, values?: { count: number }) => string;

/** The one reason shown next to the recommended apartment: "Προτείνεται: χωράει 4 άτομα". */
export function recommendationText(
  t: RecommendationTranslate,
  reasons: readonly ReasonCode[],
  partySize: number | null,
): string {
  if (reasons.includes("BOOKED_THIS_ROOM")) return t("recommendedBooked");
  if ((reasons.includes("LARGE_PARTY_ROOM") || reasons.includes("FITS_PARTY")) && partySize !== null)
    return t("recommendedFits", { count: partySize });
  if (reasons.includes("NO_GAP")) return t("recommendedNoGap");
  return t("recommended");
}

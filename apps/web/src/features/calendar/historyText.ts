import type { RouterOutputs } from "@/api/types";

type HistoryEntry = RouterOutputs["booking"]["history"][number];

export type UiLocale = "el" | "en";

const INTL: Record<UiLocale, string> = { el: "el-GR", en: "en-GB" };
const ZONE = "Europe/Athens";
const DAY_MS = 24 * 60 * 60 * 1000;

/** "Τρίτη 10:42" for the last week, "10 Οκτ 10:42" for older changes. */
export function whenText(iso: string, locale: UiLocale, now: Date = new Date()): string {
  const at = new Date(iso);
  const recent = now.getTime() - at.getTime() < 6 * DAY_MS && at.getTime() <= now.getTime() + DAY_MS;
  const day = new Intl.DateTimeFormat(INTL[locale], {
    timeZone: ZONE,
    ...(recent ? { weekday: "long" } : { day: "numeric", month: "short" }),
  }).format(at);
  const time = new Intl.DateTimeFormat(INTL[locale], {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  return `${day} ${time}`;
}

export type HistoryTranslator = (key: string, values?: Record<string, string | number>) => string;

/** One sentence for one change. Unknown kinds read as a plain "a change was made". */
export function historySentence(
  entry: HistoryEntry,
  t: HistoryTranslator,
  locale: UiLocale,
  now: Date = new Date(),
): string {
  const when = whenText(entry.at, locale, now);
  const { event } = entry;
  switch (event.kind) {
    case "moved":
      if (event.from && event.to) return t("moved", { from: event.from, to: event.to, when });
      if (event.to) return t("placed", { to: event.to, when });
      if (event.from) return t("removed", { from: event.from, when });
      return t("movedUnknown", { when });
    case "edited": {
      const names = event.fields.map((field) => t("field", { field }));
      if (names.length === 0) return t("other", { when });
      const fields = new Intl.ListFormat(INTL[locale], { style: "long", type: "conjunction" }).format(names);
      return t("edited", { fields, when });
    }
    case "reset":
      return t("reset", { field: t("field", { field: event.field }), when });
    case "created":
      return t("created", { when });
    case "synced":
      return t("synced", { when });
    case "datesFollowed":
      return t("datesFollowed", { when });
    case "movedOutBySync":
      return t("movedOutBySync", { when });
    case "cancelled":
      return t("cancelled", { when });
    default:
      return t("other", { when });
  }
}

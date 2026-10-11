import type { IsoDate } from "@stay-ops/domain";
import { formatDay } from "@/ui/format";
import {
  DEFAULT_TEMPLATES,
  PLACEHOLDERS,
  type MessageKind,
  type MessageLanguage,
  type Placeholder,
  type TemplateOverride,
} from "./defaults";

/** What a message says about one booking. */
export type MessageContext = {
  guestName: string | null;
  checkin: IsoDate;
  checkout: IsoDate;
  nights: number;
  /** The apartment's name; null while the booking has none. */
  apartment: string | null;
  /** Adults + children; null when unknown. */
  partySize: number | null;
};

/** The text that applies: this apartment's own, else the one for all apartments, else the built-in one. */
export function resolveTemplate(
  overrides: readonly TemplateOverride[],
  kind: MessageKind,
  lang: MessageLanguage,
  roomId: string | null,
): string {
  const same = (o: TemplateOverride) => o.kind === kind && o.lang === lang;
  const own = roomId === null ? undefined : overrides.find((o) => same(o) && o.roomId === roomId);
  const shared = overrides.find((o) => same(o) && o.roomId === null);
  return (own ?? shared)?.text ?? DEFAULT_TEMPLATES[kind][lang];
}

function nightsText(count: number, lang: MessageLanguage): string {
  if (lang === "el") return count === 1 ? "1 νύχτα" : `${count} νύχτες`;
  return count === 1 ? "1 night" : `${count} nights`;
}

function peopleText(count: number | null, lang: MessageLanguage): string {
  if (count === null) return "";
  if (lang === "el") return count === 1 ? "1 άτομο" : `${count} άτομα`;
  return count === 1 ? "1 guest" : `${count} guests`;
}

/** The first name or the whole name as Hosthub sent it; empty when there is none. */
function guestText(name: string | null): string {
  return (name ?? "").trim();
}

/**
 * Puts the booking into a template. A missing guest name or party size gives an empty text and the space or comma
 * left behind is tidied away; a missing apartment says it will be told later. Dates are written in the template's
 * language. Anything between braces that is not a placeholder stays as written.
 */
export function fillTemplate(text: string, context: MessageContext, lang: MessageLanguage): string {
  const values: Record<Placeholder, string> = {
    guest: guestText(context.guestName),
    checkin: formatDay(context.checkin, lang, true),
    checkout: formatDay(context.checkout, lang, true),
    apartment: context.apartment?.trim() || (lang === "el" ? "θα σας ενημερώσουμε" : "we will let you know"),
    nights: nightsText(context.nights, lang),
    people: peopleText(context.partySize, lang),
  };
  const pattern = new RegExp(`\\{(${PLACEHOLDERS.join("|")})\\}`, "g");
  return text
    .replace(pattern, (_, name: Placeholder) => values[name])
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+([,.!;:?])/g, "$1")
        .replace(/[ \t]{2,}/g, " ")
        .trimEnd(),
    )
    .join("\n")
    .trim();
}

/** A made-up booking for previews. */
export function sampleContext(lang: MessageLanguage, apartment: string | null): MessageContext {
  return {
    guestName: lang === "el" ? "Μαρία Παπαδοπούλου" : "Maria Smith",
    checkin: "2030-07-12" as IsoDate,
    checkout: "2030-07-16" as IsoDate,
    nights: 4,
    apartment: apartment ?? "Cosmos",
    partySize: 3,
  };
}

/** Greek if the phone is a Greek number (+30, 0030 or a 69… mobile); English otherwise, also with no phone. */
export function defaultLanguage(phone: string | null | undefined): MessageLanguage {
  const compact = (phone ?? "").replace(/[\s().-]/g, "");
  return /^(\+30|0030|69)/.test(compact) ? "el" : "en";
}

/** The WhatsApp link for this phone and text. Without a (usable) phone it opens WhatsApp to choose a contact. */
export function whatsappUrl(phone: string | null | undefined, text: string): string {
  let digits = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  // A Greek mobile written without the country code.
  if (/^69\d{8}$/.test(digits)) digits = `30${digits}`;
  const query = `text=${encodeURIComponent(text)}`;
  return digits.length >= 7 ? `https://wa.me/${digits}?${query}` : `https://wa.me/?${query}`;
}

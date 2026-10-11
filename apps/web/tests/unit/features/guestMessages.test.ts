import { describe, expect, it } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import {
  DEFAULT_TEMPLATES,
  MESSAGE_KINDS,
  MESSAGE_LANGUAGES,
  PLACEHOLDERS,
  type TemplateOverride,
} from "@/i18n/guestMessages/defaults";
import {
  defaultLanguage,
  fillTemplate,
  resolveTemplate,
  sampleContext,
  whatsappUrl,
  type MessageContext,
} from "@/i18n/guestMessages/fill";

const context: MessageContext = {
  guestName: "Maria Smith",
  checkin: "2030-07-12" as IsoDate,
  checkout: "2030-07-16" as IsoDate,
  nights: 4,
  apartment: "Cosmos",
  partySize: 3,
};

describe("fillTemplate", () => {
  it("fills every placeholder, with dates in the template's language", () => {
    const text = "{guest}|{checkin}|{checkout}|{apartment}|{nights}|{people}";
    expect(fillTemplate(text, context, "en")).toBe(
      "Maria Smith|Fri 12 Jul 2030|Tue 16 Jul 2030|Cosmos|4 nights|3 guests",
    );
    expect(fillTemplate(text, context, "el")).toBe(
      "Maria Smith|Παρ 12 Ιουλ 2030|Τρι 16 Ιουλ 2030|Cosmos|4 νύχτες|3 άτομα",
    );
  });

  it("says 1 νύχτα / 1 άτομο and 1 night / 1 guest", () => {
    const one = { ...context, nights: 1, partySize: 1 };
    expect(fillTemplate("{nights}, {people}", one, "el")).toBe("1 νύχτα, 1 άτομο");
    expect(fillTemplate("{nights}, {people}", one, "en")).toBe("1 night, 1 guest");
  });

  it("repeats a placeholder and leaves unknown braces alone", () => {
    expect(fillTemplate("{guest} {guest} {nope} {Guest}", context, "en")).toBe(
      "Maria Smith Maria Smith {nope} {Guest}",
    );
  });

  it("without a guest name or party size leaves no stray space before punctuation", () => {
    const empty = { ...context, guestName: null, partySize: null };
    expect(fillTemplate("Hello {guest}!\nFor {people}.", empty, "en")).toBe("Hello!\nFor.");
    expect(fillTemplate("Καλησπέρα {guest}, καλώς ήρθατε", { ...empty, guestName: "  " }, "el")).toBe(
      "Καλησπέρα, καλώς ήρθατε",
    );
  });

  it("without an apartment says it will be told later", () => {
    const none = { ...context, apartment: null };
    expect(fillTemplate("Apartment: {apartment}", none, "en")).toBe("Apartment: we will let you know");
    expect(fillTemplate("Διαμέρισμα: {apartment}", none, "el")).toBe("Διαμέρισμα: θα σας ενημερώσουμε");
  });

  it("every built-in text exists, uses only known placeholders and fills without leftovers", () => {
    for (const kind of MESSAGE_KINDS) {
      for (const lang of MESSAGE_LANGUAGES) {
        const template = DEFAULT_TEMPLATES[kind][lang];
        expect(template.trim(), `${kind}.${lang}`).not.toBe("");
        for (const [, name] of template.matchAll(/\{(\w+)\}/g)) expect(PLACEHOLDERS).toContain(name);
        const filled = fillTemplate(template, sampleContext(lang, null), lang);
        expect(filled).not.toMatch(/\{\w+\}/);
        // Greek texts are Greek, English texts have no Greek letters.
        expect(/[Ͱ-Ͽ]/.test(filled), `${kind}.${lang}`).toBe(lang === "el");
      }
    }
  });

  it("the Wi-Fi and directions defaults have obvious [placeholders] to fill in", () => {
    for (const kind of ["wifi", "directions"] as const) {
      for (const lang of MESSAGE_LANGUAGES) expect(DEFAULT_TEMPLATES[kind][lang]).toMatch(/\[[^\]]+\]/);
    }
  });
});

describe("resolveTemplate", () => {
  const overrides: TemplateOverride[] = [
    { kind: "wifi", lang: "en", roomId: null, text: "shared" },
    { kind: "wifi", lang: "en", roomId: "r1", text: "own" },
    { kind: "wifi", lang: "el", roomId: "r2", text: "only r2" },
  ];

  it("prefers the apartment's own text, then the shared one, then the built-in one", () => {
    expect(resolveTemplate(overrides, "wifi", "en", "r1")).toBe("own");
    expect(resolveTemplate(overrides, "wifi", "en", "r2")).toBe("shared");
    expect(resolveTemplate(overrides, "wifi", "en", null)).toBe("shared");
    expect(resolveTemplate(overrides, "wifi", "el", "r1")).toBe(DEFAULT_TEMPLATES.wifi.el);
    expect(resolveTemplate(overrides, "wifi", "el", "r2")).toBe("only r2");
    expect(resolveTemplate(overrides, "welcome", "en", "r1")).toBe(DEFAULT_TEMPLATES.welcome.en);
    expect(resolveTemplate([], "checkin", "el", null)).toBe(DEFAULT_TEMPLATES.checkin.el);
  });
});

describe("defaultLanguage", () => {
  it("is Greek for Greek numbers and English otherwise, also without a phone", () => {
    for (const phone of ["+30 691 234 5678", "0030 6912345678", "6912345678", "69 1234 5678"]) {
      expect(defaultLanguage(phone), phone).toBe("el");
    }
    for (const phone of ["+44 7700 900123", "+49 151 2345678", "2101234567", "", null, undefined]) {
      expect(defaultLanguage(phone), String(phone)).toBe("en");
    }
  });
});

describe("whatsappUrl", () => {
  it("uses the phone's digits without + or leading 00, and encodes the text", () => {
    expect(whatsappUrl("+30 691 234 5678", "Hi & bye\nnew line")).toBe(
      "https://wa.me/306912345678?text=Hi%20%26%20bye%0Anew%20line",
    );
    expect(whatsappUrl("0044 7700 900123", "x")).toBe("https://wa.me/447700900123?text=x");
  });

  it("adds Greece's code to a Greek mobile written without it", () => {
    expect(whatsappUrl("6912345678", "x")).toBe("https://wa.me/306912345678?text=x");
  });

  it("opens the contact chooser when there is no usable phone", () => {
    expect(whatsappUrl(null, "Γεια σας")).toBe(`https://wa.me/?text=${encodeURIComponent("Γεια σας")}`);
    expect(whatsappUrl("12", "x")).toBe("https://wa.me/?text=x");
  });
});

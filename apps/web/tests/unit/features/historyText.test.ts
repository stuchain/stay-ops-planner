import { describe, expect, it } from "vitest";
import el from "../../../messages/el.json";
import en from "../../../messages/en.json";
import { historySentence, whenText } from "@/features/calendar/historyText";
import type { RouterOutputs } from "@/api/types";

type Entry = RouterOutputs["booking"]["history"][number];

/** A tiny translator over the message files, enough for the plain and {name} messages used here. */
function translator(messages: typeof el | typeof en) {
  const h = messages.history as Record<string, string>;
  return (key: string, values: Record<string, string | number> = {}) => {
    if (key === "field") {
      const m = /\{field, select, (.*)\}/.exec(h.field!)![1]!;
      const found = new RegExp(`${values.field} \\{([^}]*)\\}`).exec(m) ?? /other \{([^}]*)\}/.exec(m);
      return found![1]!;
    }
    return (h[key] ?? "").replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
  };
}

// Tuesday 2026-10-13, 10:42 in Athens (UTC+3).
const AT = "2026-10-13T07:42:00.000Z";
const NOW = new Date("2026-10-14T09:00:00.000Z");

const entry = (event: Entry["event"]): Entry => ({ id: "e1", at: AT, event });

describe("history sentences", () => {
  it("says when with the weekday and the time, in Greek", () => {
    expect(whenText(AT, "el", NOW)).toBe("Τρίτη 10:42");
    expect(whenText(AT, "el", new Date("2026-11-20T09:00:00.000Z"))).toMatch(/13 Οκτ.* 10:42/);
  });

  it("describes a move in a sentence", () => {
    const text = historySentence(entry({ kind: "moved", from: "Onar", to: "Cosmos" }), translator(el), "el", NOW);
    expect(text).toBe("Μετακινήθηκε από Onar σε Cosmos, Τρίτη 10:42");
  });

  it("describes edits, resets, placing and taking out", () => {
    const t = translator(el);
    expect(historySentence(entry({ kind: "edited", fields: ["guestName", "partySize"] }), t, "el", NOW)).toBe(
      "Αλλάξατε το όνομα και τον αριθμό ατόμων, Τρίτη 10:42",
    );
    expect(historySentence(entry({ kind: "reset", field: "notes" }), t, "el", NOW)).toContain("τις σημειώσεις");
    expect(historySentence(entry({ kind: "moved", from: null, to: "Cosmos" }), t, "el", NOW)).toBe(
      "Μπήκε στο Cosmos, Τρίτη 10:42",
    );
    expect(historySentence(entry({ kind: "moved", from: "Onar", to: null }), t, "el", NOW)).toBe(
      "Βγήκε από το Onar, Τρίτη 10:42",
    );
  });

  it("gives an unknown change a generic sentence, never a code", () => {
    const unknown = { kind: "something_new_and_odd" } as unknown as Entry["event"];
    const text = historySentence(entry(unknown), translator(el), "el", NOW);
    expect(text).toBe("Έγινε μια αλλαγή, Τρίτη 10:42");
    expect(text).not.toMatch(/something|odd|_/);
    expect(historySentence(entry({ kind: "other" }), translator(el), "el", NOW)).toBe(text);
  });

  it("every kind has a sentence in both languages", () => {
    const kinds: Entry["event"][] = [
      { kind: "moved", from: "A", to: "B" },
      { kind: "edited", fields: ["notes"] },
      { kind: "reset", field: "partySize" },
      { kind: "created" },
      { kind: "synced" },
      { kind: "datesFollowed" },
      { kind: "movedOutBySync" },
      { kind: "cancelled" },
      { kind: "other" },
    ];
    for (const event of kinds) {
      for (const [locale, messages] of [
        ["el", el],
        ["en", en],
      ] as const) {
        const text = historySentence(entry(event), translator(messages), locale, NOW);
        expect(text).not.toMatch(/undefined|\{|\}/);
      }
    }
  });
});

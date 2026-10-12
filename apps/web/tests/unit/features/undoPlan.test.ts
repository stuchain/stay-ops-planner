import { describe, expect, it } from "vitest";
import { undoPlan } from "@/features/calendar/BookingEdit";
import { searchKey, searchWords } from "@/server/useCases/bookingSearch";
import { mondayOn } from "@/server/useCases/weekSummary";

describe("undoPlan", () => {
  it("sends back values the server accepts and restores empty ones from Hosthub", () => {
    const before = { guestName: "", partySize: "", notes: "" };
    expect(undoPlan(before, ["guestName", "partySize", "notes"])).toEqual({
      restore: { notes: "" },
      reset: ["guestName", "partySize"],
    });
    expect(undoPlan({ guestName: " Νίκος ", partySize: "3", notes: "x" }, ["guestName", "partySize"])).toEqual({
      restore: { guestName: "Νίκος", partySize: 3 },
      reset: [],
    });
  });
});

describe("search words", () => {
  it("folds case, Greek accents and final sigma", () => {
    expect(searchKey("ΠΑΠΑΔΌΠΟΥΛΟΣ")).toBe("παπαδοπουλοσ");
    expect(searchKey("Μαρία")).toBe("μαρια");
    expect(searchWords("  Μαρία  Παπαδοπούλου ")).toEqual(["μαρια", "παπαδοπουλου"]);
  });

  it("keeps a phone number typed with spaces as one word", () => {
    expect(searchWords("+30 691 234 5678")).toEqual(["+306912345678"]);
    expect(searchWords("")).toEqual([]);
  });
});

describe("mondayOn", () => {
  it("finds the Monday of the week", () => {
    expect(mondayOn("2026-10-12" as never)).toBe("2026-10-12");
    expect(mondayOn("2026-10-18" as never)).toBe("2026-10-12");
    expect(mondayOn("2026-10-14" as never)).toBe("2026-10-12");
  });
});

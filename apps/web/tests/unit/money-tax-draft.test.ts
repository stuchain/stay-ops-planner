import { describe, expect, it } from "vitest";
import { SPREADSHEET_BRACKETS } from "@stay-ops/domain";
import {
  addBracket,
  checkDraft,
  draftFromBrackets,
  formatRateInput,
  parseRateInput,
  removeBracket,
} from "@/features/money/taxRulesDraft";

describe("tax bracket draft", () => {
  it("reads rates typed as percent", () => {
    expect(parseRateInput("15")).toBe(1500);
    expect(parseRateInput("22,5")).toBe(2250);
    expect(parseRateInput(" 22.75 % ")).toBe(2275);
    expect(parseRateInput("100")).toBe(10_000);
    expect(parseRateInput("0")).toBe(0);
    for (const bad of ["", "abc", "-5", "100,01", "101", "15,555", "1.000"]) expect(parseRateInput(bad)).toBeNull();
    expect(formatRateInput(1550)).toBe("15,5");
    expect(formatRateInput(4500)).toBe("45");
  });

  it("round-trips the spreadsheet brackets", () => {
    const draft = draftFromBrackets(SPREADSHEET_BRACKETS);
    expect(draft).toEqual([
      { limit: "12.000", rate: "15" },
      { limit: "35.000", rate: "35" },
      { limit: "", rate: "45" },
    ]);
    expect(checkDraft(draft)).toEqual({ ok: true, brackets: SPREADSHEET_BRACKETS });
    expect(draftFromBrackets([{ upToCents: 1_234_550, rateBps: 900 }])[0]!.limit).toBe("12.345,50");
  });

  it("adds before the open bracket and keeps the last one open on removal", () => {
    const draft = draftFromBrackets(SPREADSHEET_BRACKETS);
    const added = addBracket(draft);
    expect(added).toHaveLength(4);
    expect(added[2]).toEqual({ limit: "", rate: "45" });
    expect(added[3]).toEqual({ limit: "", rate: "45" });
    expect(addBracket([])).toEqual([
      { limit: "", rate: "" },
      { limit: "", rate: "" },
    ]);
    const removed = removeBracket(draft, 2);
    expect(removed).toEqual([
      { limit: "12.000", rate: "15" },
      { limit: "", rate: "35" },
    ]);
    expect(removeBracket([{ limit: "", rate: "10" }], 0)).toEqual([{ limit: "", rate: "10" }]);
  });

  it("reports each box that needs correcting", () => {
    const result = checkDraft([
      { limit: "20.000", rate: "10" },
      { limit: "15.000", rate: "abc" },
      { limit: "0", rate: "20" },
      { limit: "ignored", rate: "30" },
    ]);
    expect(result).toEqual({
      ok: false,
      errors: [
        { index: 1, field: "limit", code: "limitNotRising" },
        { index: 1, field: "rate", code: "rateInvalid" },
        { index: 2, field: "limit", code: "limitInvalid" },
      ],
    });
  });
});

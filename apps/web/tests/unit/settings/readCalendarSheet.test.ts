import { describe, expect, it } from "vitest";
import { paperStays } from "@stay-ops/domain";
import { CalendarSheetError, readCalendarSheet } from "@/server/paperCalendar/readCalendarSheet";
import { paperCalendarWorkbook } from "../../fixtures/paperCalendarWorkbook";

describe("readCalendarSheet", () => {
  it("reads every night of every apartment, the day number and the guest count out of the Onar cell", async () => {
    const file = await paperCalendarWorkbook(
      2026,
      [
        { date: "2026-07-08", apartment: 3, text: "STELIOS 2" },
        { date: "2026-07-09", apartment: 2, text: "STELIOS 2" },
        { date: "2026-07-10", apartment: 2, text: "STELIOS 2" },
        { date: "2026-08-01", apartment: 0, text: "TODNER 2" },
        { date: "2026-08-02", apartment: 0, text: "TODNER 2" },
        { date: "2026-08-02", apartment: 1, text: "Μαρία" },
      ],
      { bannerYear: { 8: 2025 }, noDayNumber: ["2026-08-02"], stray: "You" },
    );
    const nights = await readCalendarSheet(file);
    expect(nights.sort((a, b) => a.date.localeCompare(b.date) || a.apartment - b.apartment)).toEqual([
      { date: "2026-07-08", apartment: 3, text: "STELIOS 2" },
      { date: "2026-07-09", apartment: 2, text: "STELIOS 2" },
      { date: "2026-07-10", apartment: 2, text: "STELIOS 2" },
      { date: "2026-08-01", apartment: 0, text: "TODNER 2" },
      { date: "2026-08-02", apartment: 0, text: "TODNER 2" },
      { date: "2026-08-02", apartment: 1, text: "Μαρία" },
    ]);
    expect(paperStays(nights).map((s) => [s.name, s.start, s.end, s.parts.length])).toEqual([
      ["STELIOS", "2026-07-08", "2026-07-11", 2],
      ["TODNER", "2026-08-01", "2026-08-03", 1],
      ["Μαρία", "2026-08-02", "2026-08-03", 1],
    ]);
  });

  it("says when the file is not the calendar", async () => {
    await expect(readCalendarSheet(Buffer.from("not a spreadsheet"))).rejects.toBeInstanceOf(CalendarSheetError);
    const empty = await paperCalendarWorkbook(2026, []);
    await expect(readCalendarSheet(empty)).rejects.toBeInstanceOf(CalendarSheetError);
  });
});

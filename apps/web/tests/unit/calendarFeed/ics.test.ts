import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine } from "@/server/calendarFeed/ics";

const NOW = new Date("2026-10-12T06:00:00Z");

describe("calendar feed iCalendar", () => {
  it("escapes commas, semicolons, backslashes and line breaks", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("folds long lines at 75 bytes without splitting a Greek letter", () => {
    const line = `SUMMARY:${"Άφιξη ".repeat(30)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, part] of parts.entries()) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(part.startsWith(" ")).toBe(true);
    }
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(line);
  });

  it("writes all-day events with a reminder the day before", () => {
    const ics = buildIcs({
      name: "Κρατήσεις",
      refreshMinutes: 60,
      now: NOW,
      events: [
        {
          uid: "b1-arrival@stay-ops-planner",
          date: "2026-12-31",
          summary: "Άφιξη: Maria · Onar",
          description: "Onar · Airbnb\n2 άτομα",
          lastModified: new Date("2026-10-01T10:00:00Z"),
          alarmMinutesBefore: 15 * 60,
        },
        {
          uid: "b1-departure@stay-ops-planner",
          date: "2027-01-03",
          summary: "Αναχώρηση: Maria · Onar",
          lastModified: new Date("2026-10-01T10:00:00Z"),
        },
      ],
    });
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((line) => !line.includes("\n"))).toBe(true);
    expect(ics).toContain("X-WR-CALNAME:Κρατήσεις");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(ics).toContain("DTSTAMP:20261012T060000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
    expect(ics).toContain("DESCRIPTION:Onar · Airbnb\\n2 άτομα");
    expect(ics).toContain(
      "BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Άφιξη: Maria · Onar\r\nTRIGGER:-PT15H\r\nEND:VALARM",
    );
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
});

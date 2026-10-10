import { describe, expect, it } from "vitest";
import { isoDate } from "@stay-ops/domain";
import { formatDay, formatMoney, formatRange, nightsBetween } from "@/ui/format";

const d = isoDate;

describe("formatDay", () => {
  it.each([
    ["2025-10-17", "Παρ 17 Οκτ"],
    ["2026-10-17", "Σαβ 17 Οκτ"],
    ["2026-01-01", "Πεμ 1 Ιαν"],
    ["2026-12-31", "Πεμ 31 Δεκ"],
    ["2026-05-01", "Παρ 1 Μαΐ"],
    ["2026-02-28", "Σαβ 28 Φεβ"],
    ["2028-02-29", "Τρι 29 Φεβ"],
    ["2026-09-08", "Τρι 8 Σεπ"],
    ["2026-06-07", "Κυρ 7 Ιουν"],
    ["2026-07-15", "Τετ 15 Ιουλ"],
    ["2026-08-03", "Δευ 3 Αυγ"],
    ["2026-03-31", "Τρι 31 Μαρ"],
    ["2026-04-30", "Πεμ 30 Απρ"],
    ["2026-11-04", "Τετ 4 Νοε"],
  ])("%s -> %s", (iso, expected) => {
    expect(formatDay(d(iso), "el")).toBe(expected);
  });

  it("has no dots and no accents on weekdays, for 400 consecutive days", () => {
    for (let i = 0; i < 400; i++) {
      const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const text = formatDay(d(date));
      expect(text).toMatch(/^[Α-Ωα-ω]{3} \d{1,2} [Α-Ωα-ωΐ]{3,4}$/);
      const weekday = text.split(" ")[0]!;
      expect(weekday).toBe(weekday.normalize("NFD").replace(/[̀-ͯ]/g, ""));
    }
  });

  it("adds the year only when asked", () => {
    expect(formatDay(d("2026-10-17"), "el", true)).toBe("Σαβ 17 Οκτ 2026");
  });

  it("formats English", () => {
    expect(formatDay(d("2025-10-17"), "en")).toBe("Fri 17 Oct");
    expect(formatDay(d("2026-09-17"), "en")).toBe("Thu 17 Sep");
  });
});

describe("formatRange", () => {
  it("repeats the month only when it differs", () => {
    expect(formatRange(d("2025-10-17"), d("2025-10-21"))).toBe("Παρ 17 – Τρι 21 Οκτ");
    expect(formatRange(d("2025-10-31"), d("2025-11-04"))).toBe("Παρ 31 Οκτ – Τρι 4 Νοε");
  });

  it("handles year boundaries", () => {
    expect(formatRange(d("2026-12-30"), d("2027-01-03"))).toBe("Τετ 30 Δεκ – Κυρ 3 Ιαν");
    expect(formatRange(d("2026-12-30"), d("2027-01-03"), "el", true)).toBe("Τετ 30 Δεκ 2026 – Κυρ 3 Ιαν 2027");
    expect(formatRange(d("2026-10-10"), d("2026-10-12"), "el", true)).toBe("Σαβ 10 – Δευ 12 Οκτ 2026");
  });

  it("does not shift dates across DST changes", () => {
    expect(formatRange(d("2026-03-29"), d("2026-03-30"))).toBe("Κυρ 29 – Δευ 30 Μαρ");
    expect(formatRange(d("2026-10-25"), d("2026-10-26"))).toBe("Κυρ 25 – Δευ 26 Οκτ");
  });

  it("formats English", () => {
    expect(formatRange(d("2025-10-31"), d("2025-11-04"), "en")).toBe("Fri 31 Oct – Tue 4 Nov");
  });
});

describe("nights", () => {
  it("counts nights", () => {
    expect(nightsBetween(d("2026-02-27"), d("2026-03-02"))).toBe(3);
    expect(nightsBetween(d("2026-12-30"), d("2027-01-03"))).toBe(4);
  });
});

describe("formatMoney", () => {
  it("formats Greek amounts", () => {
    expect(formatMoney(125000)).toBe("1.250 €");
    expect(formatMoney(1250)).toBe("12,50 €");
    expect(formatMoney(0)).toBe("0 €");
    expect(formatMoney(99)).toBe("0,99 €");
    expect(formatMoney(5)).toBe("0,05 €");
    expect(formatMoney(123456789)).toBe("1.234.567,89 €");
    expect(formatMoney(100000)).toBe("1.000 €");
    expect(formatMoney(-125000)).toBe("−1.250 €");
  });

  it("formats English amounts", () => {
    expect(formatMoney(125000, "en")).toBe("€1,250");
    expect(formatMoney(1250, "en")).toBe("€12.50");
  });
});

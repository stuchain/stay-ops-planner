import { describe, expect, it } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import type { CalendarBlock, CalendarBooking, CalendarRoom } from "@/api/types";
import { buildMonth, buildWeek, mondayOf, shiftSheet, sheetEnd, sheetStart } from "@/features/print/layout";
import { PrintSheetView } from "@/features/print/PrintSheet";
import { render, screen, within } from "../intl";

const iso = (s: string) => s as IsoDate;

const ONAR: CalendarRoom = {
  id: "r1",
  name: "Onar",
  color: "#0F766E",
  capacity: 4,
  preferredForLargeParty: false,
  isActive: true,
};
const COSMOS: CalendarRoom = { ...ONAR, id: "r2", name: "Cosmos", color: "#7C3AED" };

function booking(
  over: Partial<CalendarBooking> & Pick<CalendarBooking, "id" | "checkin" | "checkout">,
): CalendarBooking {
  const nights = Math.round((Date.parse(over.checkout) - Date.parse(over.checkin)) / 86_400_000);
  const merged = {
    nights,
    guestName: "Maria Papadopoulou",
    partySize: 2,
    channel: "airbnb",
    status: "confirmed",
    version: 1,
    assignment: { roomId: "r1", pinned: false },
    ...over,
  } as CalendarBooking;
  // The apartment's nights follow the assignment unless a test gives its own pieces.
  return {
    ...merged,
    pieces:
      over.pieces ??
      (merged.assignment ? [{ roomId: merged.assignment.roomId, start: merged.checkin, end: merged.checkout }] : []),
  };
}

const block = (over: Partial<CalendarBlock> & Pick<CalendarBlock, "start" | "end">): CalendarBlock => ({
  id: "bl1",
  roomId: "r1",
  reason: null,
  ...over,
});

// Mon 12 Oct 2026 is the first day of the week sheet.
const FROM = iso("2026-10-12");

describe("sheet dates", () => {
  it("finds the Monday, the month start and the neighbours", () => {
    expect(mondayOf(iso("2026-10-18"))).toBe("2026-10-12");
    expect(mondayOf(iso("2026-10-12"))).toBe("2026-10-12");
    expect(mondayOf(iso("2026-10-11"))).toBe("2026-10-05");
    expect(sheetStart("month", iso("2026-10-18"))).toBe("2026-10-01");
    expect(sheetEnd("week", FROM)).toBe("2026-10-19");
    expect(sheetEnd("month", iso("2026-12-01"))).toBe("2027-01-01");
    expect(shiftSheet("week", FROM, -1)).toBe("2026-10-05");
    expect(shiftSheet("month", iso("2026-01-01"), -1)).toBe("2025-12-01");
  });
});

describe("buildWeek", () => {
  it("puts a guest in every night from check-in up to check-out and marks arrival and departure", () => {
    const stay = booking({ id: "a", checkin: iso("2026-10-14"), checkout: iso("2026-10-16") });
    const week = buildWeek({ rooms: [ONAR], bookings: [stay], blocks: [] }, FROM);
    expect(week.days).toHaveLength(7);
    const cells = week.rows[0]!.cells;
    const summary = cells.map((c) => c.entries.map((e) => `${e.kind}${e.arrival ? "+arrival" : ""}`));
    expect(summary).toEqual([[], [], ["stay+arrival"], ["stay"], ["departure"], [], []]);
  });

  it("shows both the departure and the arrival of a same-day turnover, departure first", () => {
    const out = booking({ id: "out", checkin: iso("2026-10-10"), checkout: iso("2026-10-14"), guestName: "Out" });
    const inn = booking({ id: "in", checkin: iso("2026-10-14"), checkout: iso("2026-10-17"), guestName: "In" });
    const week = buildWeek({ rooms: [ONAR], bookings: [inn, out], blocks: [] }, FROM);
    const turnover = week.rows[0]!.cells[2]!;
    expect(turnover.entries.map((e) => [e.kind, e.booking.id, e.arrival])).toEqual([
      ["departure", "out", false],
      ["stay", "in", true],
    ]);
  });

  it("keeps a stay that began before the week and one that goes on after it", () => {
    const long = booking({ id: "long", checkin: iso("2026-10-05"), checkout: iso("2026-10-25") });
    const week = buildWeek({ rooms: [ONAR], bookings: [long], blocks: [] }, FROM);
    expect(week.rows[0]!.cells.every((c) => c.entries.length === 1 && !c.entries[0]!.arrival)).toBe(true);
  });

  it("keeps each apartment's bookings in its own row and marks closed days", () => {
    const a = booking({ id: "a", checkin: iso("2026-10-12"), checkout: iso("2026-10-13") });
    const b = booking({
      id: "b",
      checkin: iso("2026-10-12"),
      checkout: iso("2026-10-13"),
      assignment: { roomId: "r2", pinned: false },
    });
    const week = buildWeek(
      {
        rooms: [ONAR, COSMOS],
        bookings: [a, b],
        blocks: [block({ start: iso("2026-10-15"), end: iso("2026-10-17") })],
      },
      FROM,
    );
    expect(week.rows.map((r) => r.room.name)).toEqual(["Onar", "Cosmos"]);
    expect(week.rows[0]!.cells[0]!.entries.map((e) => e.booking.id)).toEqual(["a"]);
    expect(week.rows[1]!.cells[0]!.entries.map((e) => e.booking.id)).toEqual(["b"]);
    expect(week.rows[0]!.cells.map((c) => c.closed)).toEqual([false, false, false, true, true, false, false]);
    expect(week.rows[1]!.cells.some((c) => c.closed)).toBe(false);
  });

  it("lists unplaced bookings by arrival and hides an inactive apartment with nothing in the week", () => {
    const late = booking({ id: "late", checkin: iso("2026-10-16"), checkout: iso("2026-10-18"), assignment: null });
    const early = booking({
      id: "early",
      checkin: iso("2026-10-13"),
      checkout: iso("2026-10-14"),
      assignment: null,
      status: "pending",
    });
    const week = buildWeek(
      { rooms: [ONAR, { ...COSMOS, isActive: false }], bookings: [late, early], blocks: [] },
      FROM,
    );
    expect(week.unplaced.map((b) => b.id)).toEqual(["early", "late"]);
    expect(week.rows.map((r) => r.room.name)).toEqual(["Onar"]);
  });
});

describe("buildMonth", () => {
  it("lists each apartment's stays and closed periods in date order", () => {
    const later = booking({ id: "later", checkin: iso("2026-10-20"), checkout: iso("2026-10-22") });
    const earlier = booking({ id: "earlier", checkin: iso("2026-10-02"), checkout: iso("2026-10-05") });
    const outside = booking({ id: "outside", checkin: iso("2026-11-02"), checkout: iso("2026-11-05") });
    const month = buildMonth(
      {
        rooms: [ONAR],
        bookings: [later, earlier, outside],
        blocks: [block({ start: iso("2026-10-10"), end: iso("2026-10-12") })],
      },
      iso("2026-10-01"),
    );
    expect(month.sections[0]!.items.map((i) => [i.kind, i.nights])).toEqual([
      ["stay", 3],
      ["closed", 2],
      ["stay", 2],
    ]);
  });
});

describe("PrintSheetView", () => {
  const data = {
    rooms: [ONAR, COSMOS],
    bookings: [
      booking({ id: "out", checkin: iso("2026-10-10"), checkout: iso("2026-10-14"), guestName: "Out Guest" }),
      booking({
        id: "in",
        checkin: iso("2026-10-14"),
        checkout: iso("2026-10-17"),
        guestName: "In Guest",
        partySize: 3,
      }),
      booking({
        id: "wait",
        checkin: iso("2026-10-15"),
        checkout: iso("2026-10-18"),
        guestName: "Waiting Guest",
        assignment: null,
        status: "pending",
      }),
    ],
    blocks: [block({ id: "bl", roomId: "r2", start: iso("2026-10-12"), end: iso("2026-10-14") })],
  };

  it("draws the week table with turnover marks, closed days and the unplaced list", () => {
    render(<PrintSheetView view="week" from={FROM} data={data} printedAt={new Date("2026-10-11T09:30:00Z")} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Εβδομάδα 12–18 Οκτωβρίου 2026");
    expect(screen.getByText(/^Τυπώθηκε:/)).toBeTruthy();
    const onar = screen.getByRole("row", { name: /Onar/ });
    expect(within(onar).getAllByText("Αναχώρηση →")).toHaveLength(2);
    expect(within(onar).getByText("→ Άφιξη")).toBeTruthy();
    expect(within(onar).getAllByText("Out Guest").length).toBeGreaterThan(1);
    expect(within(onar).getAllByText("In Guest").length).toBeGreaterThan(1);
    expect(within(screen.getByRole("row", { name: /Cosmos/ })).getAllByText("Κλειστό")).toHaveLength(2);
    const unplaced = screen.getByRole("region", { name: "Χωρίς διαμέρισμα" });
    expect(within(unplaced).getByText("Waiting Guest")).toBeTruthy();
    expect(within(unplaced).getByText(/Περιμένει επιβεβαίωση/)).toBeTruthy();
  });

  it("draws the month sheet with a section per apartment", () => {
    render(<PrintSheetView view="month" from={iso("2026-10-01")} data={data} printedAt={null} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Οκτώβριος 2026$/);
    const onar = screen.getByRole("region", { name: "Onar" });
    expect(within(onar).getAllByRole("row")).toHaveLength(2);
    expect(within(onar).getByText("3 νύχτες")).toBeTruthy();
    expect(within(onar).getByText("3 άτομα")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Cosmos" })).getByText("Κλειστό")).toBeTruthy();
  });
});

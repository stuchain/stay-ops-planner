// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cents, defaultTaxRules, type Cents, type LedgerValues } from "@stay-ops/domain";
import type { LedgerRowData, LedgerYearData } from "@/api/types";
import { ExcelSheet } from "@/features/money/ExcelSheet";
import {
  cellText,
  parseCell,
  patchFor,
  rowTone,
  sheetAmount,
  sheetLines,
  SHEET_COLUMNS,
} from "@/features/money/sheetModel";
import { cleanup, render, screen, waitFor, within } from "../intl";

const calls = vi.hoisted(() => ({ update: vi.fn(), add: vi.fn(), rename: vi.fn(), remove: vi.fn() }));

vi.mock("@/api/client", () => {
  const mutation = (fn: (input: unknown) => unknown) => ({
    mutationOptions: () => ({ mutationFn: async (input: unknown) => fn(input) }),
  });
  const trpc = {
    money: {
      year: { pathKey: () => ["money", "year"] },
      updateRow: mutation((i) => calls.update(i)),
      addManualRow: mutation((i) => calls.add(i)),
      editManualRow: mutation((i) => calls.rename(i)),
      deleteManualRow: mutation((i) => calls.remove(i)),
    },
  };
  return { useTRPC: () => trpc };
});

vi.mock("@/ui/Toast", () => ({ showToast: vi.fn() }));

afterEach(cleanup);
beforeEach(() => Object.values(calls).forEach((f) => f.mockReset().mockResolvedValue({})));

const c = (euros: number) => cents(Math.round(euros * 100));
const four = (a = 0, b = 0, d = 0, e = 0) => [a, b, d, e].map((v) => cents(v)) as [Cents, Cents, Cents, Cents];

function values(over: Partial<LedgerValues>): LedgerValues {
  return {
    name: "",
    guestCount: null,
    passport: "",
    roomLocation: "",
    dateRange: "",
    nights: null,
    airbnbCents: null,
    bookingCents: null,
    contractCents: null,
    soloCents: null,
    prepaymentCents: null,
    payoutCents: null,
    rentalIndex: null,
    ...over,
  };
}

function row(over: Partial<LedgerRowData> & { auto: LedgerValues; shownOver?: Partial<LedgerValues> }): LedgerRowData {
  const { auto, shownOver, ...rest } = over;
  const shown = { ...auto, ...shownOver };
  const rentalCents = [1, 2, 3, 4].map((i) =>
    shown.rentalIndex === i ? (shown.airbnbCents ?? shown.bookingCents ?? shown.prepaymentCents) : null,
  );
  return {
    key: "b1",
    bookingId: "b1",
    entryId: null,
    manual: false,
    checkin: "2026-10-12",
    checkout: "2026-10-19",
    month: 10,
    channel: "airbnb",
    status: "confirmed",
    kind: "confirmed",
    counts: true,
    auto,
    shown: { ...shown, rentalCents },
    overrides: {},
    overridden: [],
    bucketSource: "listing",
    stayedRentalIndex: null,
    foreignCurrency: false,
    hosthubChanged: false,
    version: 1,
    ...rest,
  } as unknown as LedgerRowData;
}

const verena = row({
  auto: values({
    name: "VERENA MUNSTERMANN",
    guestCount: 2,
    dateRange: "12-19/10",
    nights: 7,
    airbnbCents: c(860),
    payoutCents: c(694.71),
    rentalIndex: 2,
  }),
});
const elena = row({
  key: "b2",
  bookingId: "b2",
  channel: "direct",
  auto: values({
    name: "ELENA SMYTH",
    guestCount: 2,
    dateRange: "12-19/10",
    nights: 7,
    soloCents: c(600),
    prepaymentCents: c(135),
    payoutCents: c(735),
    rentalIndex: 1,
  }),
});

function ledger(rows: LedgerRowData[]): LedgerYearData {
  const rules = { ...defaultTaxRules(2026), scope: "per_apartment" as const };
  return {
    year: 2026,
    years: [2025, 2026],
    rules,
    apartments: (["Onar", "Cosmos", "Iris", "Helios"] as const).map((label, i) => ({
      index: (i + 1) as 1 | 2 | 3 | 4,
      label,
      color: null,
    })),
    rows,
    totals: {
      byRentalCents: four(13_500, 86_000),
      totalCents: cents(99_500),
      soloCents: cents(60_000),
      payoutCents: cents(142_971),
      unbucketedCount: 0,
      unbucketedCents: cents(0),
      monthlyCents: Array.from({ length: 12 }, () => four()),
    },
    tax: {
      scope: "per_apartment",
      calculations: [2025, 12_900, 0, 0].map((v) => ({ taxCents: cents(v), lines: [], incomeCents: cents(0) })),
      taxCents: cents(14_925),
    },
  } as unknown as LedgerYearData;
}

const column = (letter: string) => SHEET_COLUMNS.find((col) => col.letter === letter)!;

describe("sheet model", () => {
  it("writes amounts like his Excel: no € sign, no thousands dots, cents only when there are some", () => {
    expect(sheetAmount(c(694.71))).toBe("694,71");
    expect(sheetAmount(c(1680))).toBe("1680");
    expect(sheetAmount(c(1066.3))).toBe("1066,3");
    expect(sheetAmount(c(-50))).toBe("-50");
    expect(sheetAmount(null)).toBe("");
  });

  it("lays out each month as a band, its rows, then empty lines", () => {
    const lines = sheetLines([verena, elena]);
    expect(lines).toHaveLength(12 + 2 + 12 * 2);
    const october = lines.findIndex((l) => l.type === "month" && l.month === 10);
    expect(lines.slice(october, october + 5).map((l) => l.type)).toEqual(["month", "row", "row", "spare", "spare"]);
    expect(lines[0]!.line).toBe(2); // row 1 is the header
  });

  it("shows the guests after the name, and reads them back when typed", () => {
    expect(cellText(verena, column("B"), "gross")).toBe("VERENA MUNSTERMANN 2");
    expect(parseCell(column("B"), "VERENA MUNSTERMANN 3")).toEqual({
      ok: true,
      values: { name: "VERENA MUNSTERMANN", guestCount: 3 },
    });
    expect(patchFor(verena, { name: "VERENA MUNSTERMANN", guestCount: 3 }, "gross")).toEqual({ guestCount: 3 });
  });

  it("reads Greek amounts, blanks and apartment numbers, and refuses typos", () => {
    expect(parseCell(column("L"), "1.234,56")).toEqual({ ok: true, values: { payoutCents: 123_456 } });
    expect(parseCell(column("L"), "")).toEqual({ ok: true, values: { payoutCents: null } });
    expect(parseCell(column("L"), "δώδεκα")).toEqual({ ok: false, error: "badAmount" });
    expect(parseCell(column("M"), "4")).toEqual({ ok: true, values: { rentalIndex: 4 } });
    expect(parseCell(column("M"), "5")).toEqual({ ok: false, error: "badApartment" });
    expect(parseCell(column("F"), "7,5")).toEqual({ ok: false, error: "badNumber" });
  });

  it("drops a correction when Hosthub's own value is typed back", () => {
    const corrected = row({
      auto: verena.auto,
      shownOver: { payoutCents: c(690) },
      overridden: ["payoutCents"],
    });
    expect(patchFor(corrected, { payoutCents: c(694.71) }, "gross")).toEqual({ payoutCents: "revert" });
    expect(patchFor(corrected, { payoutCents: c(690) }, "gross")).toEqual({});
  });

  it("colours rows like the sheet", () => {
    expect(rowTone(verena)).toBe("platform");
    expect(rowTone(elena)).toBe("direct");
    expect(rowTone(row({ auto: verena.auto, kind: "cancelled_paid" }))).toBe("cancelled");
  });
});

function show(rows: LedgerRowData[], onYear = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ExcelSheet ledger={ledger(rows)} currentMonth={10} onYear={onYear} />
    </QueryClientProvider>,
  );
  return { onYear };
}

describe("ExcelSheet", () => {
  it("shows the sheet's columns, month bands, totals and tax", () => {
    show([verena, elena]);
    const grid = screen.getByRole("grid", { name: "Έσοδα 2026, σαν το Excel" });
    expect(within(grid).getByRole("columnheader", { name: "ΟΝΟΜΑ ΚΑΙ ΑΤΟΜΑ" })).toBeTruthy();
    expect(within(grid).getByRole("columnheader", { name: "ΚΑΘΑΡΟ" })).toBeTruthy();
    expect(within(grid).getByText("ΟΚΤΩΒΡΙΟΣ")).toBeTruthy();
    expect(within(grid).getByText("VERENA MUNSTERMANN 2")).toBeTruthy();
    expect(within(grid).getByText("694,71")).toBeTruthy();
    expect(within(grid).getByRole("rowheader", { name: "ΦΟΡΟΣ" })).toBeTruthy();
    expect(within(grid).getByText("149,25")).toBeTruthy(); // total tax
  });

  it("saves a typed amount as a correction of that cell", async () => {
    const user = userEvent.setup();
    show([verena]);
    const payout = screen.getByRole("gridcell", { name: /^L\d+, ΚΑΘΑΡΟ: 694,71$/ });
    await user.click(payout);
    await user.keyboard("690{Enter}");
    await waitFor(() =>
      expect(calls.update).toHaveBeenCalledWith({
        target: { bookingId: "b1" },
        expectedVersion: 1,
        patch: { payoutCents: 69_000 },
      }),
    );
  });

  it("shows Hosthub's value for a changed cell and puts it back", async () => {
    const user = userEvent.setup();
    show([row({ auto: verena.auto, shownOver: { payoutCents: c(690) }, overridden: ["payoutCents"] })]);
    await user.click(screen.getByRole("gridcell", { name: /^L\d+, ΚΑΘΑΡΟ: 690\. Διορθωμένο$/ }));
    expect(screen.getByText("Από Hosthub: 694,71")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Επαναφορά" }));
    await waitFor(() =>
      expect(calls.update).toHaveBeenCalledWith({
        target: { bookingId: "b1" },
        expectedVersion: 1,
        patch: { payoutCents: "revert" },
      }),
    );
  });

  it("adds a row when a name is typed in an empty line of the month", async () => {
    const user = userEvent.setup();
    show([verena]);
    const october = sheetLines([verena]).find((l) => l.type === "spare" && l.month === 10)!;
    await user.click(screen.getByRole("gridcell", { name: `B${october.line}, ΟΝΟΜΑ ΚΑΙ ΑΤΟΜΑ` }));
    await user.keyboard("ΕΠΙΣΤΡΟΦΗ{Enter}");
    await waitFor(() =>
      expect(calls.add).toHaveBeenCalledWith(expect.objectContaining({ year: 2026, month: 10, label: "ΕΠΙΣΤΡΟΦΗ" })),
    );
  });

  it("switches year from the tabs at the bottom", async () => {
    const user = userEvent.setup();
    const { onYear } = show([verena]);
    await user.click(screen.getByRole("button", { name: "2025" }));
    expect(onYear).toHaveBeenCalledWith(2025);
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { cents, defaultTaxRules, isoDate, ledgerTax, ledgerTotals, type Cents } from "@stay-ops/domain";
import type { LedgerYearData } from "@/api/types";
import { IncomeScreen } from "@/features/money/IncomeScreen";
import { changeOnLastYear, formatChange, formatRate, incomeView, monthKind } from "@/features/money/incomeView";
import { TaxFold } from "@/features/money/TaxCard";
import { latinWords, render, screen } from "../intl";

const ledgers = new Map<number, LedgerYearData>();

// The Excel view has its own tests; here only the switch to it matters.
vi.mock("@/features/money/ExcelSheet", () => ({ ExcelSheet: () => <div data-testid="excel-sheet" /> }));

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    money: {
      year: {
        queryOptions: (input: { year: number }) => ({
          queryKey: ["money.year", input],
          queryFn: async () => {
            const found = ledgers.get(input.year);
            if (!found) throw new Error("no ledger");
            return found;
          },
        }),
      },
    },
  }),
}));

// jsdom has no layout: opening the details scrolls to them.
Element.prototype.scrollIntoView = vi.fn();

const four = (a: number, b = 0, c = 0, d = 0) => [a, b, c, d].map((v) => cents(v)) as [Cents, Cents, Cents, Cents];

function fakeLedger(
  scope: "total" | "per_apartment" = "total",
  { year = 2026, years = [2026], scale = 1, unbucketedCount = 0 } = {},
): LedgerYearData {
  const monthlyCents = Array.from({ length: 12 }, (_, i) => four((i + 1) * 100_000 * scale, 50_000 * scale));
  const byRental = four(7_800_000 * scale, 600_000 * scale);
  const totals = {
    byRentalCents: byRental,
    totalCents: cents(8_400_000 * scale),
    soloCents: cents(0),
    payoutCents: cents(7_000_000),
    unbucketedCount,
    unbucketedCents: cents(unbucketedCount * 10_000),
    monthlyCents,
  };
  const rules = { ...defaultTaxRules(year), scope };
  return {
    year,
    years,
    rules,
    apartments: (["Onar", "Cosmos", "Iris", "Helios"] as const).map((label, i) => ({
      index: (i + 1) as 1 | 2 | 3 | 4,
      label,
      color: null,
    })),
    rows: [],
    totals,
    tax: ledgerTax(totals as ReturnType<typeof ledgerTotals>, rules),
  } as unknown as LedgerYearData;
}

/** Every text node, space-separated, so adjacent labels don't run together. */
function screenText(root: HTMLElement): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");
  return parts.join(" ");
}

describe("incomeView", () => {
  it("splits the year at the current month", () => {
    expect(monthKind(2026, 9, "2026-10-10")).toBe("actual");
    expect(monthKind(2026, 10, "2026-10-10")).toBe("current");
    expect(monthKind(2026, 11, "2026-10-10")).toBe("expected");
    expect(monthKind(2025, 12, "2026-10-10")).toBe("actual");
    expect(monthKind(2027, 1, "2026-10-10")).toBe("expected");

    const view = incomeView(fakeLedger(), "2026-10-10");
    // Jan–Oct: (1..10) × 1,000 € + 10 × 500 €; Nov–Dec are expected.
    expect(view.soFarCents).toBe(5_500_000 + 500_000);
    expect(view.expectedCents).toBe(8_400_000 - 6_000_000);
    expect(view.futureMonths).toEqual([11, 12]);
    expect(view.months[0]).toMatchObject({ month: 1, kind: "actual", totalCents: 150_000 });
  });

  it("compares this year so far with the same months last year", () => {
    // Jan–Oct last year: half of this year's 60,000 €.
    expect(changeOnLastYear(6_000_000, fakeLedger("total", { year: 2025, scale: 0.5 }), 2026, "2026-10-10")).toBe(1);
    expect(changeOnLastYear(5_400_000, fakeLedger(), 2026, "2026-10-10")).toBeCloseTo(-0.1);
    expect(changeOnLastYear(100, fakeLedger("total", { scale: 0 }), 2026, "2026-10-10")).toBeNull();
    expect(formatChange(0.124)).toBe("+12%");
    expect(formatChange(-0.05)).toBe("−5%");
    expect(formatChange(0.001)).toBe("0%");
  });

  it("formats rates per language", () => {
    expect(formatRate(1500, "el")).toBe("15%");
    expect(formatRate(2250, "el")).toBe("22,5%");
    expect(formatRate(2250, "en")).toBe("22.5%");
  });
});

function showIncome(devMode = false) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {(<IncomeScreen today={isoDate("2026-10-10")} devMode={devMode} />) as ReactNode}
    </QueryClientProvider>,
  );
}

describe("IncomeScreen", () => {
  it("shows the year so far, what is still to come, last year and the tax in one card", async () => {
    ledgers.clear();
    ledgers.set(2026, fakeLedger("per_apartment", { years: [2025, 2026] }));
    ledgers.set(2025, fakeLedger("per_apartment", { year: 2025, years: [2025, 2026], scale: 0.5 }));
    const { container } = showIncome();
    const card = await screen.findByTestId("income-so-far");
    expect(card).toHaveTextContent("Μέχρι σήμερα");
    expect(card).toHaveTextContent(/60\.000\s€/);
    expect(card).toHaveTextContent(/Έρχονται ακόμα 24\.000\s€/);
    expect(await screen.findByText("+100%")).toBeInTheDocument();
    expect(card).toHaveTextContent("Σε σχέση με πέρσι");
    // The year's tax in the card, then one line per apartment; the bracket tables stay folded.
    expect(screen.getAllByText(/^Φόρος περίπου/)).toHaveLength(5);
    expect(screen.getByText("Πώς υπολογίζεται ο φόρος;").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "Ανά μήνα" })).toBeInTheDocument();
    // Gone from this screen: the chart, the occupancy grid, the warning when nothing is missing, Statistics.
    expect(screen.queryByRole("list", { name: /Έσοδα ανά μήνα/ })).toBeNull();
    expect(screen.queryByText("Πληρότητα και τιμές")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("link", { name: "Στατιστικά" })).toBeNull();
    expect(latinWords(screenText(container), ["Excel"])).toEqual([]);
  });

  it("says nothing about last year when there is no last year", async () => {
    ledgers.clear();
    ledgers.set(2026, fakeLedger());
    showIncome();
    expect(await screen.findByTestId("income-so-far")).not.toHaveTextContent("Σε σχέση με πέρσι");
  });

  it("warns about bookings outside an apartment, with a button that opens the Excel view", async () => {
    ledgers.clear();
    ledgers.set(2026, fakeLedger("total", { unbucketedCount: 12 }));
    showIncome(true);
    const warning = await screen.findByRole("status");
    expect(warning).toHaveTextContent("12 κρατήσεις δεν μετράνε σε διαμέρισμα");
    // Statistics is for Dev mode only.
    expect(screen.getByRole("link", { name: "Στατιστικά" })).toHaveAttribute("href", "/app/stats");
    const excel = screen.getByRole("button", { name: "Σαν το Excel" });
    expect(excel).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Δείτε τις κρατήσεις" }));
    expect(screen.getByRole("button", { name: "Σαν το Excel" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("excel-sheet")).toBeInTheDocument();
  });
});

describe("Έσοδα widgets", () => {
  it("explains the tax in Greek, bracket by bracket", () => {
    const { container } = render(<TaxFold ledger={fakeLedger()} />);
    expect(screen.getByText("15% μέχρι 12.000 €")).toBeTruthy();
    expect(screen.getByText("25% από 12.000 € έως 24.000 €")).toBeTruthy();
    expect(screen.getByText("35% από 24.000 € έως 35.000 €")).toBeTruthy();
    expect(screen.getByText("45% πάνω από 35.000 €")).toBeTruthy();
    // 84,000 €: 1,800 + 3,000 + 3,850 + 49,000 × 45% = 30,700 €
    expect(screen.getAllByText("30.700 €").length).toBeGreaterThan(0);
    expect(screen.getByText("Τα κλιμάκια δεν έχουν επιβεβαιωθεί ακόμα από τον λογιστή.")).toBeTruthy();
    expect(screen.getByText("Πώς υπολογίζεται ο φόρος;")).toBeTruthy();
    expect(screen.getByText(/Ο λογιστής θα επιβεβαιώσει το τελικό ποσό/)).toBeTruthy();
    expect(latinWords(screenText(container))).toEqual([]);
  });

  it("shows one table per apartment when tax is per apartment", () => {
    render(<TaxFold ledger={fakeLedger("per_apartment")} />);
    expect(screen.getByText("Φόρος για Onar")).toBeTruthy();
    expect(screen.getByText("Φόρος για Helios")).toBeTruthy();
  });
});

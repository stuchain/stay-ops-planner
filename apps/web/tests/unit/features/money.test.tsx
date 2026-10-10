import { describe, expect, it } from "vitest";
import { cents, defaultTaxRules, ledgerTax, ledgerTotals, type Cents } from "@stay-ops/domain";
import type { LedgerYearData } from "@/api/types";
import { formatRate, incomeView, monthKind } from "@/features/money/incomeView";
import { MonthlyChart } from "@/features/money/MonthlyChart";
import { TaxCard } from "@/features/money/TaxCard";
import { latinWords, render, screen } from "../intl";

const four = (a: number, b = 0, c = 0, d = 0) => [a, b, c, d].map((v) => cents(v)) as [Cents, Cents, Cents, Cents];

function fakeLedger(scope: "total" | "per_apartment" = "total"): LedgerYearData {
  const monthlyCents = Array.from({ length: 12 }, (_, i) => four((i + 1) * 100_000, 50_000));
  const byRental = four(7_800_000, 600_000);
  const totals = {
    byRentalCents: byRental,
    totalCents: cents(8_400_000),
    soloCents: cents(0),
    payoutCents: cents(7_000_000),
    unbucketedCount: 0,
    unbucketedCents: cents(0),
    monthlyCents,
  };
  const rules = { ...defaultTaxRules(2026), scope };
  return {
    year: 2026,
    years: [2026],
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

  it("formats rates per language", () => {
    expect(formatRate(1500, "el")).toBe("15%");
    expect(formatRate(2250, "el")).toBe("22,5%");
    expect(formatRate(2250, "en")).toBe("22.5%");
  });
});

describe("Έσοδα widgets", () => {
  it("explains the tax in Greek, bracket by bracket", () => {
    const { container } = render(<TaxCard ledger={fakeLedger()} />);
    expect(screen.getByText("15% μέχρι 12.000 €")).toBeTruthy();
    expect(screen.getByText("35% από 12.000 € έως 35.000 €")).toBeTruthy();
    expect(screen.getByText("45% πάνω από 35.000 €")).toBeTruthy();
    // 84,000 €: 1,800 + 8,050 + 49,000 × 45% = 31,900 €
    expect(screen.getAllByText("31.900 €").length).toBeGreaterThan(0);
    expect(screen.getByText("Τα κλιμάκια δεν έχουν επιβεβαιωθεί ακόμα από τον λογιστή.")).toBeTruthy();
    expect(screen.getByText("Πώς υπολογίζεται;")).toBeTruthy();
    expect(latinWords(screenText(container))).toEqual([]);
  });

  it("shows one table per apartment when tax is per apartment", () => {
    render(<TaxCard ledger={fakeLedger("per_apartment")} />);
    expect(screen.getByText("Φόρος για Onar")).toBeTruthy();
    expect(screen.getByText("Φόρος για Helios")).toBeTruthy();
  });

  it("labels every month bar with its amounts for screen readers", () => {
    const ledger = fakeLedger();
    const view = incomeView(ledger, "2026-10-10");
    const { container } = render(<MonthlyChart year={2026} months={view.months} apartments={ledger.apartments} />);
    expect(screen.getByRole("list", { name: "Έσοδα ανά μήνα, 2026" })).toBeTruthy();
    expect(
      screen.getByRole("listitem", {
        name: /^Οκτώβριος: 10\.500\s€\. Onar 10\.000\s€, Cosmos 500\s€, Iris 0\s€, Helios 0\s€$/,
      }),
    ).toBeTruthy();
    expect(screen.getByText("Τώρα")).toBeTruthy();
    expect(latinWords(screenText(container))).toEqual([]);
  });
});

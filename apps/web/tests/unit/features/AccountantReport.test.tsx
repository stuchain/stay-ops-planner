import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  applyLedgerOverrides,
  cents,
  defaultTaxRules,
  ledgerTax,
  ledgerTotals,
  type IsoDate,
  type LedgerValues,
} from "@stay-ops/domain";
import type { LedgerRowData, LedgerYearData } from "@/api/types";
import { AccountantReport } from "@/features/money/AccountantReport";
import { latinWords, render, screen, within } from "../intl";

let result: () => Promise<LedgerYearData>;

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    money: { year: { queryOptions: () => ({ queryKey: ["money.year"], queryFn: () => result() }) } },
  }),
}));

const EMPTY_AUTO: LedgerValues = {
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
};

function row(
  key: string,
  month: number,
  values: Partial<LedgerValues>,
  extra: Partial<LedgerRowData> = {},
): LedgerRowData {
  const auto = { ...EMPTY_AUTO, ...values };
  const shown = { ...applyLedgerOverrides(auto, {}, "gross"), overridden: undefined };
  return {
    key,
    bookingId: key,
    entryId: null,
    manual: false,
    checkin: null,
    checkout: null,
    month,
    channel: "airbnb",
    status: "confirmed",
    kind: "confirmed",
    counts: true,
    auto,
    shown,
    overrides: {},
    overridden: [],
    bucketSource: "listing",
    stayedRentalIndex: null,
    foreignCurrency: false,
    hosthubChanged: false,
    version: 0,
    ...extra,
  } as unknown as LedgerRowData;
}

function fakeLedger(confirmed: boolean): LedgerYearData {
  const rows = [
    row("a", 7, { name: "MARIA", dateRange: "1-5/7/", airbnbCents: cents(40_000), rentalIndex: 1 }),
    row(
      "b",
      7,
      { name: "JOHN", dateRange: "10-12/7/", bookingCents: cents(25_000), rentalIndex: 2 },
      { channel: "booking" },
    ),
    row(
      "m",
      8,
      { name: "CASH GUEST", soloCents: cents(10_000), rentalIndex: 3 },
      { manual: true, channel: null, kind: "manual" },
    ),
    row("p", 8, { name: "REQUEST", airbnbCents: cents(99_000), rentalIndex: 1 }, { counts: false, kind: "pending" }),
  ];
  const rules = { ...defaultTaxRules(2030), confirmed };
  const totals = ledgerTotals(rows, rules.incomeBasis);
  return {
    year: 2030,
    years: [2030],
    rules,
    apartments: (["Onar", "Cosmos", "Iris", "Helios"] as const).map((label, i) => ({
      index: (i + 1) as 1 | 2 | 3 | 4,
      label,
      color: null,
    })),
    rows,
    totals,
    tax: ledgerTax(totals, rules),
  } as unknown as LedgerYearData;
}

function show(ledger: LedgerYearData) {
  result = async () => ledger;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AccountantReport year={2030} today={"2030-10-11" as IsoDate} />
    </QueryClientProvider>,
  );
}

describe("AccountantReport", () => {
  it("shows the year, totals, tax and bookings with month subtotals, all in Greek", async () => {
    const { container } = show(fakeLedger(true));
    expect(await screen.findByRole("heading", { level: 1, name: "Έσοδα 2030" })).toBeInTheDocument();
    expect(screen.getByText(/Φτιάχτηκε στις/)).toHaveTextContent("2030");
    expect(screen.getByText("Οι συντελεστές έχουν επιβεβαιωθεί από τον λογιστή.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Μετράει το μικτό ποσό: όσα πλήρωσε ο επισκέπτης.")).toBeInTheDocument();

    // 750 € in total: 15% of it is 112,50 €.
    const tax = screen.getByRole("heading", { name: "Υπολογισμός φόρου" }).closest("section")!;
    expect(within(tax).getByText("Έως 12.000 €")).toBeInTheDocument();
    expect(within(tax).getByText("15%")).toBeInTheDocument();
    expect(within(tax).getByText("Συνολικός φόρος").nextSibling).toHaveTextContent("112,50 €");

    const bookings = screen.getByRole("heading", { name: "Όλες οι κρατήσεις" }).closest("section")!;
    expect(within(bookings).getByText("MARIA")).toBeInTheDocument();
    expect(within(bookings).getByText("CASH GUEST")).toBeInTheDocument();
    expect(within(bookings).getByText("Χειροκίνητη εγγραφή")).toBeInTheDocument();
    expect(within(bookings).queryByText("REQUEST")).toBeNull();
    const july = within(bookings).getByRole("row", { name: /Σύνολο: Ιούλιος/ });
    expect(july).toHaveTextContent("400 €");
    expect(july).toHaveTextContent("250 €");
    expect(july).toHaveTextContent("650 €");
    expect(within(bookings).getByRole("row", { name: /Σύνολο: Αύγουστος/ })).toHaveTextContent("100 €");
    expect(within(bookings).getByRole("row", { name: /Σύνολο χρονιάς/ })).toHaveTextContent("750 €");
    expect(within(bookings).getByText(/1 αίτημα ή ακύρωση χωρίς πληρωμή δεν φαίνεται/)).toBeInTheDocument();
    expect(container.querySelectorAll("thead.table-header-group").length).toBeGreaterThan(1);
    const text = [...container.querySelectorAll("*")]
      .flatMap((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? ""))
      .join(" ");
    expect(latinWords(text, ["MARIA", "JOHN", "CASH", "GUEST", "PDF"])).toEqual([]);
  });

  it("warns clearly when the accountant has not confirmed the rates", async () => {
    show(fakeLedger(false));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Προσοχή: οι συντελεστές δεν έχουν επιβεβαιωθεί από τον λογιστή. Ο φόρος είναι εκτίμηση.",
    );
  });

  it("prints with the browser's print dialog", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    show(fakeLedger(true));
    const button = await screen.findByRole("button", { name: "Εκτύπωση / Αποθήκευση ως PDF" });
    await vi.waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(print).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Πίσω στα Έσοδα" })).toHaveAttribute("href", "/app/excel");
  });

  it("shows one tax table per apartment when tax is per apartment", async () => {
    const ledger = fakeLedger(true);
    const rules = { ...ledger.rules, scope: "per_apartment" as const };
    const tax = ledgerTax(ledger.totals as ReturnType<typeof ledgerTotals>, rules);
    show({ ...ledger, rules, tax } as unknown as LedgerYearData);
    expect(await screen.findByText("Φόρος για Onar")).toBeInTheDocument();
    expect(screen.getByText("Φόρος για Helios")).toBeInTheDocument();
    expect(screen.getByText("Οι συντελεστές έχουν επιβεβαιωθεί από τον λογιστή.")).toBeInTheDocument();
  });
});

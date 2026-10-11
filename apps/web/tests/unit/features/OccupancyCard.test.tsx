import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OccupancyData } from "@/api/types";
import { OccupancyCard } from "@/features/money/OccupancyCard";
import { latinWords, render, screen, within } from "../intl";

let result: () => Promise<OccupancyData>;

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    money: { occupancy: { queryOptions: () => ({ queryKey: ["money.occupancy"], queryFn: () => result() }) } },
  }),
}));

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const year = (nights: number[], revenue = 10_000) => [
  {
    roomId: "r1",
    months: DAYS.map((daysInMonth, i) => ({
      daysInMonth,
      nights: nights[i] ?? 0,
      revenueCents: (nights[i] ?? 0) * revenue,
    })),
  },
];

function show(data: OccupancyData) {
  result = async () => data;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {(<OccupancyCard year={2030} />) as ReactNode}
    </QueryClientProvider>,
  );
}

describe("OccupancyCard", () => {
  it("shows occupancy, price per night and the change on last year, in Greek", async () => {
    const { container } = show({
      year: 2030,
      apartments: [{ id: "r1", name: "Onar", color: "#0F766E" }],
      thisYear: year([31, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      lastYear: year([15, 14, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0], 9_000),
    });
    expect(await screen.findByRole("heading", { name: "Πληρότητα και τιμές" })).toBeInTheDocument();
    expect(screen.getByText(/μαζί με τις μελλοντικές κρατήσεις/)).toBeInTheDocument();
    const row = await screen.findByRole("row", { name: /Onar/ });
    const cells = within(row).getAllByRole("cell");
    expect(cells).toHaveLength(13);
    // January: 31 of 31 nights, 100 € a night, 52 points above last year (48%).
    expect(cells[0]).toHaveTextContent("100%");
    expect(cells[0]).toHaveTextContent("100 €");
    expect(
      within(cells[0]!).getByText("Περισσότερη πληρότητα κατά 52 ποσοστιαίες μονάδες από πέρσι"),
    ).toBeInTheDocument();
    // February: the same as last year, so no arrow.
    expect(cells[1]).toHaveTextContent("50%");
    expect(cells[1]!.textContent).not.toMatch(/▲|▼/);
    // March: down 10 points, and no price without nights.
    expect(cells[2]).toHaveTextContent("0%");
    expect(cells[2]).toHaveTextContent("—");
    expect(within(cells[2]!).getByText("Λιγότερη πληρότητα κατά 10 ποσοστιαίες μονάδες από πέρσι")).toBeInTheDocument();
    // The year: 45 of 365 nights.
    expect(cells[12]).toHaveTextContent("12%");
    expect(latinWords(container.textContent ?? "")).toEqual([]);
  });

  it("scrolls the wide table inside the card", async () => {
    const { container } = show({
      year: 2030,
      apartments: [{ id: "r1", name: "Onar", color: null }],
      thisYear: year([]),
      lastYear: year([]),
    });
    await screen.findByRole("table");
    expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
  });

  it("says so when there are no apartments", async () => {
    show({ year: 2030, apartments: [], thisYear: [], lastYear: [] });
    expect(await screen.findByText("Δεν υπάρχουν διαμερίσματα.")).toBeInTheDocument();
  });
});

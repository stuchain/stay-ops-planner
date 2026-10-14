import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isoDate, statsPeriod, yearStats, type StatsBooking } from "@stay-ops/domain";
import type { ReviewsData, StatisticsData } from "@/api/types";
import { parseScore } from "@/features/stats/ReviewsCard";
import { StatisticsScreen } from "@/features/stats/StatisticsScreen";
import { latinWords, render, screen, waitFor, within } from "../intl";

let stats: () => Promise<StatisticsData>;
let reviews: () => Promise<ReviewsData>;
const recordScore = vi.fn();
const addSource = vi.fn();
const refreshGoogle = vi.fn();

const mutation = (fn: (input: unknown) => unknown) => ({
  mutationOptions: (opts: Record<string, unknown> = {}) => ({
    mutationFn: async (input: unknown) => fn(input),
    ...opts,
  }),
});

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    stats: {
      year: {
        queryOptions: (input: { year: number; toDate: boolean }) => ({
          queryKey: ["stats.year", input],
          queryFn: () => stats(),
        }),
      },
      reviews: {
        queryOptions: (input: { year: number }) => ({ queryKey: ["stats.reviews", input], queryFn: () => reviews() }),
        pathKey: () => ["stats.reviews"],
      },
      recordReviewScore: mutation((i) => recordScore(i)),
      addReviewSource: mutation((i) => addSource(i)),
      removeReviewSource: mutation(() => undefined),
      refreshGoogle: mutation((i) => refreshGoogle(i)),
    },
    // The occupancy section moved here from Έσοδα; its own test covers it.
    money: {
      occupancy: {
        queryOptions: (input: { year: number }) => ({
          queryKey: ["money.occupancy", input],
          queryFn: () => ({ year: input.year, apartments: [], thisYear: [], lastYear: [] }),
        }),
      },
    },
  }),
}));

const b = (checkin: string, checkout: string, extra: Partial<StatsBooking> = {}): StatsBooking => ({
  channel: "airbnb",
  kind: "stay",
  checkin: isoDate(checkin),
  checkout: isoDate(checkout),
  roomId: "r1",
  incomeCents: 30_000,
  payoutCents: 25_000,
  feeCents: 5_000,
  bookedOn: null,
  adults: 2,
  children: 0,
  infants: 0,
  guestKey: null,
  ...extra,
});

function data(): StatisticsData {
  const rows = [
    b("2030-07-01", "2030-07-04"),
    b("2030-08-01", "2030-08-03", { channel: "booking", incomeCents: 20_000 }),
    b("2029-07-01", "2029-07-03"),
  ];
  const through = { month: 10, day: 12 };
  return {
    year: 2030,
    toDate: true,
    through: isoDate("2030-10-12"),
    apartments: [{ id: "r1", name: "Onar", color: "#0F766E" }],
    thisYear: yearStats(rows, statsPeriod(2030, through), ["r1"]) as unknown as StatisticsData["thisYear"],
    lastYear: yearStats(rows, statsPeriod(2029, through), ["r1"]) as unknown as StatisticsData["lastYear"],
    years: [
      {
        year: 2029,
        bookings: 1,
        nights: 2,
        incomeCents: 30_000,
        averageNightCents: 15_000,
        occupancyPercent: 1,
        cancellations: 0,
      },
      {
        year: 2030,
        bookings: 2,
        nights: 5,
        incomeCents: 50_000,
        averageNightCents: 10_000,
        occupancyPercent: 1,
        cancellations: 0,
      },
    ],
    leadTimeKnown: 0,
  };
}

function show() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {(<StatisticsScreen today={isoDate("2030-10-12")} />) as ReactNode}
    </QueryClientProvider>,
  );
}

describe("StatisticsScreen", () => {
  beforeEach(() => {
    stats = async () => data();
    reviews = async () => ({ googleReady: false, sources: [] });
    recordScore.mockReset();
    addSource.mockReset();
    refreshGoogle.mockReset();
  });

  it("shows the year against last year, in Greek", async () => {
    const { container } = show();
    expect(await screen.findByRole("heading", { name: "Στατιστικά" })).toBeInTheDocument();
    const income = (await screen.findByText("Έσοδα", { selector: "span" })).closest("div")!;
    expect(income).toHaveTextContent("500 €");
    expect(income).toHaveTextContent("πέρσι 300 €");
    expect(within(income).getByText("Πάνω από πέρσι κατά 67%")).toBeInTheDocument();
    expect(screen.getByText(/Από 1 Ιανουαρίου έως/)).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Booking\.com/ })).toHaveTextContent("200 €");
    expect(screen.getByRole("row", { name: /Onar/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Όλες οι χρονιές" })).toBeInTheDocument();
    expect(await screen.findByText("Δεν έχετε προσθέσει ακόμα σελίδα με κριτικές.")).toBeInTheDocument();
    // Option labels run together in textContent ("AirbnbBooking.comGoogle").
    expect(latinWords(container.textContent ?? "", ["Google", "Google.", "AirbnbBooking.comGoogle"])).toEqual([]);
  });

  it("switches the month chart and the period", async () => {
    show();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Μήνα με μήνα" });
    await user.click(screen.getByRole("button", { name: "Νύχτες" }));
    expect(screen.getByRole("list", { name: "Νύχτες ανά μήνα, φέτος και πέρσι" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Ιούλιος: 2030 3, 2029 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Όλη η χρονιά" }));
    expect(screen.getByRole("button", { name: "Όλη η χρονιά" })).toHaveAttribute("aria-pressed", "true");
  });

  it("types a score for an Airbnb page and checks it first", async () => {
    reviews = async () => ({
      googleReady: false,
      sources: [
        {
          id: "s1",
          platform: "airbnb",
          url: "https://www.airbnb.gr/rooms/1",
          label: "Onar",
          roomId: null,
          scale: 5,
          latest: { takenOn: isoDate("2030-10-01"), rating: 4.9, count: 120, origin: "manual" },
          yearAgo: { takenOn: isoDate("2029-10-01"), rating: 4.8, count: 90 },
          yearStart: { takenOn: isoDate("2029-12-31"), rating: 4.85, count: 100 },
          latestReviews: [],
        },
      ],
    });
    show();
    const user = userEvent.setup();
    expect(await screen.findByText("4,90 / 5")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument(); // new reviews this year
    await user.type(screen.getByLabelText("Βαθμολογία (στα 5)"), "7");
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("από 0 έως 5");
    expect(recordScore).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("Βαθμολογία (στα 5)"));
    await user.type(screen.getByLabelText("Βαθμολογία (στα 5)"), "4,92");
    await user.type(screen.getByLabelText("Αριθμός κριτικών"), "125");
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(recordScore).toHaveBeenCalledWith({ sourceId: "s1", rating: 4.92, count: 125 }));
  });

  it("reads Google once when its key is set and today's score is missing", async () => {
    reviews = async () => ({
      googleReady: true,
      sources: [
        {
          id: "g1",
          platform: "google",
          url: "https://maps.app.goo.gl/abc",
          label: null,
          roomId: null,
          scale: 5,
          latest: null,
          yearAgo: null,
          yearStart: null,
          latestReviews: [],
        },
      ],
    });
    refreshGoogle.mockResolvedValue({ status: "done", updated: 0, failed: 1 });
    show();
    await waitFor(() => expect(refreshGoogle).toHaveBeenCalledWith({ language: "el" }));
    expect(screen.getByText("Η βαθμολογία ενημερώνεται μόνη της.")).toBeInTheDocument();
    expect(refreshGoogle).toHaveBeenCalledTimes(1);
  });

  it("adds a page", async () => {
    show();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Πού"), "booking");
    await user.type(screen.getByLabelText("Σύνδεσμος σελίδας"), "https://www.booking.com/hotel/gr/x.html");
    await user.click(screen.getByRole("button", { name: "Προσθήκη" }));
    await waitFor(() =>
      expect(addSource).toHaveBeenCalledWith({
        platform: "booking",
        url: "https://www.booking.com/hotel/gr/x.html",
        label: null,
        roomId: null,
      }),
    );
  });

  it("parses Greek and English decimals", () => {
    expect(parseScore("4,9")).toBe(4.9);
    expect(parseScore(" 9.4 ")).toBe(9.4);
    expect(parseScore("")).toBeNull();
    expect(Number.isNaN(parseScore("abc"))).toBe(true);
  });
});

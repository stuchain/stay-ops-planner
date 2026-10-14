import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import type { TodayStay, TodaySummary, WeekSummaryData } from "@/api/types";
import { TodayScreen } from "@/features/today/TodayScreen";
import { latinWords, render, screen, waitFor, within } from "../intl";

/** The screen's text with a space between elements (textContent glues "Onar" to the next name). */
function spokenText(root: HTMLElement): string {
  return [...root.querySelectorAll("*")]
    .flatMap((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? ""))
    .join(" ");
}

const iso = (s: string) => s as IsoDate;

let todayResult: () => Promise<TodaySummary>;
let weekResult: () => Promise<WeekSummaryData>;

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    today: {
      summary: { queryOptions: () => ({ queryKey: ["today.summary"], queryFn: () => todayResult() }) },
      week: { queryOptions: (input: unknown) => ({ queryKey: ["today.week", input], queryFn: () => weekResult() }) },
    },
    sync: {
      status: {
        queryOptions: () => ({
          queryKey: ["sync.status"],
          queryFn: async () => ({ lastSuccessAt: new Date(Date.now() - 5 * 60_000).toISOString(), running: false }),
        }),
      },
    },
  }),
}));

function stay(over: Partial<TodayStay> & Pick<TodayStay, "id">): TodayStay {
  return {
    guestName: "Maria Papadopoulou",
    partySize: 2,
    nights: 3,
    checkin: iso("2030-06-10"),
    checkout: iso("2030-06-13"),
    status: "confirmed",
    room: { id: "r1", name: "Onar", color: "#0F766E" },
    guestNotes: [],
    ...over,
  };
}

const EMPTY: TodaySummary = {
  today: iso("2030-06-10"),
  tomorrow: iso("2030-06-11"),
  arrivals: [],
  departures: [],
  tomorrowArrivals: [],
  tomorrowDepartures: [],
  needsApartment: 0,
  gaps: [],
};

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Seven quiet days from tomorrow, with the given days filled in. */
function week(filled: WeekSummaryData["days"] = []): WeekSummaryData {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = iso(`2030-06-${String(11 + i).padStart(2, "0")}`);
    return filled.find((d) => d.date === date) ?? { date, arrivals: [], departures: [], cleanings: [] };
  });
  return { today: iso("2030-06-10"), from: iso("2030-06-11"), days };
}

function show(
  summary: TodaySummary | (() => Promise<TodaySummary>),
  locale: "el" | "en" = "el",
  next: WeekSummaryData = week(),
) {
  todayResult = typeof summary === "function" ? summary : async () => summary;
  weekResult = async () => next;
  return render(
    <Wrap>
      <TodayScreen />
    </Wrap>,
    { locale },
  );
}

describe("TodayScreen", () => {
  it("shows skeletons first, with no text yet", async () => {
    show(() => new Promise(() => {}));
    expect(await screen.findByRole("status", { name: "Φόρτωση της σημερινής εικόνας" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Σήμερα" })).toBeInTheDocument();
  });

  it("is fully Greek and says nothing about Hosthub while the update works", async () => {
    const { container } = show(EMPTY);
    expect(await screen.findByText("Κανείς δεν έρχεται σήμερα.")).toBeInTheDocument();
    expect(screen.getByText("Κανείς δεν φεύγει σήμερα.")).toBeInTheDocument();
    expect(await screen.findByText("Καμία άφιξη ή αναχώρηση τις επόμενες 7 μέρες.")).toBeInTheDocument();
    // Nothing needs an apartment: no warning card at all.
    expect(screen.queryByRole("region", { name: "Χρειάζονται διαμέρισμα" })).toBeNull();
    expect(screen.queryByText(/Hosthub/)).toBeNull();
    expect(latinWords(spokenText(container))).toEqual([]);
  });

  it("lists today's guests in one list, with what needs an apartment first", async () => {
    const summary: TodaySummary = {
      ...EMPTY,
      arrivals: [
        stay({ id: "b1" }),
        stay({ id: "b2", guestName: "John Smith", partySize: 1, nights: 1, room: null }),
        stay({ id: "b3", guestName: "Pam Pending", status: "pending", room: null }),
      ],
      departures: [stay({ id: "b4", guestName: "Nikos Leaving", nights: 7, checkin: iso("2030-06-03") })],
      needsApartment: 2,
    };
    const { container } = show(summary);

    const needs = within(await screen.findByRole("region", { name: "Χρειάζονται διαμέρισμα" }));
    expect(needs.getByText("2 κρατήσεις χρειάζονται διαμέρισμα")).toBeInTheDocument();
    expect(needs.getByRole("link", { name: "Βάλτε τις σε διαμέρισμα" })).toHaveAttribute("href", "/app/calendar");

    const today = within(screen.getByRole("region", { name: "Σήμερα" }));
    const maria = today.getByRole("link", { name: /Maria Papadopoulou/ });
    expect(maria).toHaveAttribute("href", "/app/calendar?booking=b1");
    expect(maria).toHaveTextContent("Έρχεται");
    expect(maria).toHaveTextContent("2 άτομα · 3 νύχτες");
    expect(maria).toHaveTextContent("Onar");
    expect(today.getByRole("link", { name: /John Smith/ })).toHaveTextContent("1 άτομο · 1 νύχτα");
    expect(today.getByRole("link", { name: /John Smith/ })).toHaveTextContent("Χρειάζεται διαμέρισμα");
    expect(today.getByRole("link", { name: /Pam Pending/ })).toHaveTextContent("Περιμένει επιβεβαίωση");
    const nikos = today.getByRole("link", { name: /Nikos Leaving/ });
    expect(nikos).toHaveTextContent("Φεύγει");
    expect(nikos).toHaveTextContent("Έμειναν 7 νύχτες");
    expect(today.getByRole("link", { name: "Εκτύπωση καρτών άφιξης" })).toHaveAttribute(
      "href",
      "/app/arrival-cards?ids=b1,b2,b3",
    );

    expect(
      latinWords(spokenText(container), ["Maria Papadopoulou", "John Smith", "Pam Pending", "Nikos Leaving"]),
    ).toEqual([]);
  });

  it("shows the next days with arrivals or departures and skips the quiet ones", async () => {
    show(
      EMPTY,
      "el",
      week([
        {
          date: iso("2030-06-11"),
          arrivals: [stay({ id: "b5", guestName: "Elena Tomorrow", partySize: 4, nights: 2 })],
          departures: [],
          cleanings: [],
        },
        {
          date: iso("2030-06-13"),
          arrivals: [],
          departures: [stay({ id: "b6", guestName: "Paul Later", room: { id: "r2", name: "Iris", color: "#BE185D" } })],
          cleanings: [],
        },
      ]),
    );
    const next = within(await screen.findByRole("region", { name: "Επόμενες μέρες" }));
    expect(await next.findByRole("heading", { name: "Αύριο" })).toBeInTheDocument();
    expect(next.getByRole("link", { name: /Elena Tomorrow/ })).toHaveTextContent("4 άτομα · 2 νύχτες");
    expect(next.getByRole("link", { name: "Εκτύπωση καρτών άφιξης" })).toHaveAttribute(
      "href",
      "/app/arrival-cards?ids=b5",
    );
    expect(next.getByRole("link", { name: /Paul Later/ })).toHaveTextContent("Φεύγει");
    expect(next.getAllByRole("heading", { level: 4 })).toHaveLength(2);
    expect(next.getByRole("link", { name: "Εκτύπωση εβδομάδας" })).toHaveAttribute("href", "/app/week");
  });

  it("shows guest notes under arrivals and one line per gap night", async () => {
    show({
      ...EMPTY,
      arrivals: [stay({ id: "b1", guestNotes: ["Πληρώνει με την άφιξη"] })],
      gaps: [
        {
          room: { id: "r1", name: "Onar", color: "#0F766E" },
          start: iso("2030-06-14"),
          end: iso("2030-06-15"),
          nights: 1,
          bookingId: "b9",
        },
      ],
    });
    const today = within(await screen.findByRole("region", { name: "Σήμερα" }));
    expect(today.getByRole("link", { name: /Maria Papadopoulou/ })).toHaveTextContent(
      "Σημείωση: Πληρώνει με την άφιξη",
    );
    const gaps = within(screen.getByRole("list", { name: "Κενές νύχτες" }));
    const link = gaps.getByRole("link", { name: /Κενή νύχτα: .* στο Onar/ });
    expect(link).toHaveAttribute("href", "/app/calendar?booking=b9");
  });

  it("says nothing about gap nights when there are none", async () => {
    show(EMPTY);
    await screen.findByText("Κανείς δεν έρχεται σήμερα.");
    expect(screen.queryByRole("list", { name: "Κενές νύχτες" })).toBeNull();
  });

  it("says it in English when asked", async () => {
    show(EMPTY, "en");
    expect(await screen.findByText("Nobody arrives today.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
  });

  it("shows a sentence and a retry button when the load fails", async () => {
    show(() => Promise.reject(new TRPCClientError("x")));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Δοκιμάστε ξανά" })).toBeInTheDocument());
  });
});

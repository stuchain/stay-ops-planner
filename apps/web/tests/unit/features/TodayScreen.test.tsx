import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import type { TodayStay, TodaySummary } from "@/api/types";
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

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    today: { summary: { queryOptions: () => ({ queryKey: ["today.summary"], queryFn: () => todayResult() }) } },
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

function show(summary: TodaySummary | (() => Promise<TodaySummary>), locale: "el" | "en" = "el") {
  todayResult = typeof summary === "function" ? summary : async () => summary;
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

  it("is fully Greek: cards, empty sentences and the Hosthub line", async () => {
    const { container } = show(EMPTY);
    expect(await screen.findByText("Καμία άφιξη σήμερα.")).toBeInTheDocument();
    expect(screen.getByText("Καμία αναχώρηση σήμερα.")).toBeInTheDocument();
    expect(screen.getByText("Καμία άφιξη αύριο.")).toBeInTheDocument();
    expect(screen.getByText("Καμία αναχώρηση αύριο.")).toBeInTheDocument();
    expect(screen.getByText("Όλες οι κρατήσεις έχουν διαμέρισμα.")).toBeInTheDocument();
    expect(await screen.findByText("Τελευταία ενημέρωση από το Hosthub: πριν από 5 λεπτά")).toBeInTheDocument();
    expect(latinWords(spokenText(container))).toEqual([]);
  });

  it("lists guests with apartment, party and nights, and links to the calendar", async () => {
    const summary: TodaySummary = {
      ...EMPTY,
      arrivals: [
        stay({ id: "b1" }),
        stay({ id: "b2", guestName: "John Smith", partySize: 1, nights: 1, room: null }),
        stay({ id: "b3", guestName: "Pam Pending", status: "pending", room: null }),
      ],
      departures: [stay({ id: "b4", guestName: "Nikos Leaving", nights: 7, checkin: iso("2030-06-03") })],
      tomorrowArrivals: [stay({ id: "b5", guestName: "Elena Tomorrow", partySize: 4, nights: 2 })],
      needsApartment: 2,
    };
    const { container } = show(summary);

    const arrivals = within(await screen.findByRole("region", { name: "Αφίξεις σήμερα" }));
    const maria = arrivals.getByRole("link", { name: /Maria Papadopoulou/ });
    expect(maria).toHaveAttribute("href", "/app/calendar?booking=b1");
    expect(maria).toHaveTextContent("2 άτομα · 3 νύχτες");
    expect(maria).toHaveTextContent("Onar");
    expect(arrivals.getByRole("link", { name: /John Smith/ })).toHaveTextContent("1 άτομο · 1 νύχτα");
    expect(arrivals.getByRole("link", { name: /John Smith/ })).toHaveTextContent("Χρειάζεται διαμέρισμα");
    expect(arrivals.getByRole("link", { name: /Pam Pending/ })).toHaveTextContent("Περιμένει επιβεβαίωση");

    const departures = within(screen.getByRole("region", { name: "Αναχωρήσεις σήμερα" }));
    expect(departures.getByRole("link", { name: /Nikos Leaving/ })).toHaveTextContent("Έμειναν 7 νύχτες");

    const tomorrow = within(screen.getByRole("region", { name: "Αύριο" }));
    expect(tomorrow.getByRole("link", { name: /Elena Tomorrow/ })).toHaveTextContent("4 άτομα · 2 νύχτες");
    expect(tomorrow.getByText("Καμία αναχώρηση αύριο.")).toBeInTheDocument();

    // Arrival cards: one link per card with that day's arrivals; none for departures.
    expect(arrivals.getByRole("link", { name: "Εκτύπωση καρτών άφιξης" })).toHaveAttribute(
      "href",
      "/app/arrival-cards?ids=b1,b2,b3",
    );
    expect(tomorrow.getByRole("link", { name: "Εκτύπωση καρτών άφιξης" })).toHaveAttribute(
      "href",
      "/app/arrival-cards?ids=b5",
    );
    expect(departures.queryByRole("link", { name: "Εκτύπωση καρτών άφιξης" })).toBeNull();

    const needs = within(screen.getByRole("region", { name: "Χρειάζονται διαμέρισμα" }));
    expect(needs.getByText("2 κρατήσεις περιμένουν διαμέρισμα.")).toBeInTheDocument();
    expect(needs.getByRole("link", { name: "Βάλτε τις σε διαμέρισμα" })).toHaveAttribute("href", "/app/calendar");

    // Only the guests' own names and the apartment are Latin.
    expect(
      latinWords(spokenText(container), [
        "Maria Papadopoulou",
        "John Smith",
        "Pam Pending",
        "Nikos Leaving",
        "Elena Tomorrow",
      ]),
    ).toEqual([]);
  });

  it("shows guest notes under arrivals and lists gap nights with a link to the calendar", async () => {
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
    const arrivals = within(await screen.findByRole("region", { name: "Αφίξεις σήμερα" }));
    expect(arrivals.getByRole("link", { name: /Maria Papadopoulou/ })).toHaveTextContent(
      "Σημείωση: Πληρώνει με την άφιξη",
    );
    const gaps = within(screen.getByRole("region", { name: "Κενές νύχτες" }));
    const link = gaps.getByRole("link", { name: /1 κενή νύχτα/ });
    expect(link).toHaveAttribute("href", "/app/calendar?booking=b9");
    expect(link).toHaveTextContent("Onar");
  });

  it("says when there are no gap nights", async () => {
    show(EMPTY);
    expect(await screen.findByText("Καμία κενή νύχτα τις επόμενες 60 μέρες.")).toBeInTheDocument();
  });

  it("says it in English when asked", async () => {
    show(EMPTY, "en");
    expect(await screen.findByText("No arrivals today.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
  });

  it("shows a sentence and a retry button when the load fails", async () => {
    show(() => Promise.reject(new TRPCClientError("x")));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Δοκιμάστε ξανά" })).toBeInTheDocument());
  });
});

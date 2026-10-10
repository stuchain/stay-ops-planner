import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArrivalCardData } from "@/api/types";
import { ArrivalCardsScreen } from "@/features/arrivalCards/ArrivalCardsScreen";
import { arrivalCardsHref, parseIds } from "@/features/arrivalCards/ids";
import { fireEvent, render, screen, waitFor } from "../intl";

let result: () => Promise<ArrivalCardData[]>;

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    booking: {
      arrivalCards: { queryOptions: (input: unknown) => ({ queryKey: ["cards", input], queryFn: () => result() }) },
    },
  }),
}));

function card(over: Partial<ArrivalCardData> = {}): ArrivalCardData {
  return {
    id: "b1",
    guestName: "Anna Smith",
    phone: "+30 691 234 5678",
    email: "anna@example.com",
    adults: 2,
    children: 1,
    infants: 0,
    partySize: 3,
    checkin: "2030-06-10",
    checkout: "2030-06-13",
    nights: 3,
    apartment: "Cosmos",
    channel: "airbnb",
    notes: ["Arrives by ferry at 21:30"],
    previousStays: { sure: [{ bookingId: "o", checkin: "2029-08-01", apartment: "Iris" }], maybe: [] },
    ...over,
  } as ArrivalCardData;
}

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("ids", () => {
  it("parses, trims, removes repeats and limits to 30", () => {
    expect(parseIds(" a, b ,a,,c")).toEqual(["a", "b", "c"]);
    expect(parseIds(undefined)).toEqual([]);
    expect(parseIds(Array.from({ length: 40 }, (_, i) => `id${i}`).join(","))).toHaveLength(30);
    expect(arrivalCardsHref(["a", "b"])).toBe("/app/arrival-cards?ids=a,b");
  });
});

describe("ArrivalCardsScreen", () => {
  it("prints every detail of the guest, without raw data, and the print button calls window.print", async () => {
    result = async () => [
      card(),
      card({
        id: "b2",
        guestName: "Second Guest",
        phone: null,
        email: null,
        notes: [],
        previousStays: { sure: [], maybe: [] },
      }),
    ];
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(
      <Wrap>
        <ArrivalCardsScreen ids={["b1", "b2"]} />
      </Wrap>,
    );
    expect(await screen.findByRole("heading", { name: "Anna Smith" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+30 691 234 5678" })).toHaveAttribute("href", "tel:+306912345678");
    expect(screen.getByText("anna@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("Cosmos")).toHaveLength(2);
    expect(screen.getAllByText("Airbnb")).toHaveLength(2);
    expect(screen.getAllByText("3 νύχτες")).toHaveLength(2);
    expect(screen.getByText("Arrives by ferry at 21:30")).toBeInTheDocument();
    expect(screen.getByText("Έχει ξαναέρθει: Iris, Αύγουστος 2029")).toBeInTheDocument();
    expect(screen.getByText("Second Guest")).toBeInTheDocument();
    expect(screen.getByText("Δεν υπάρχουν σημειώσεις.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[{}]\s*"/);
    fireEvent.click(screen.getByRole("button", { name: "Εκτύπωση" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("explains when no booking was chosen, without asking the server", () => {
    result = () => Promise.reject(new Error("must not be called"));
    render(
      <Wrap>
        <ArrivalCardsScreen ids={[]} />
      </Wrap>,
    );
    expect(screen.getByText("Δεν επιλέχθηκε άφιξη")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Εκτύπωση" })).toBeDisabled();
  });

  it("says when the bookings are gone", async () => {
    result = async () => [];
    render(
      <Wrap>
        <ArrivalCardsScreen ids={["x"]} />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText("Δεν βρέθηκαν κρατήσεις")).toBeInTheDocument());
  });
});

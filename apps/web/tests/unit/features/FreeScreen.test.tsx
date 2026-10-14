import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import type { AvailabilityData } from "@/api/types";
import { FreeScreen } from "@/features/free/FreeScreen";
import { fireEvent, render, screen, waitFor, within } from "../intl";

const iso = (s: string) => s as IsoDate;

type Input = { checkin: string; checkout: string; guests?: number };
const calls: Input[] = [];
let result: AvailabilityData;

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    today: {
      summary: {
        queryOptions: () => ({ queryKey: ["today.summary"], queryFn: async () => ({ today: "2030-06-10" }) }),
      },
    },
    availability: {
      check: {
        queryOptions: (input: Input) => ({
          queryKey: ["availability.check", input],
          queryFn: async () => {
            calls.push(input);
            return result;
          },
        }),
      },
    },
  }),
}));

function room(
  over: Partial<AvailabilityData["rooms"][number]> & Pick<AvailabilityData["rooms"][number], "roomId" | "name">,
) {
  return {
    color: "#0F766E",
    capacity: 4,
    isActive: true,
    available: true,
    recommended: false,
    reasons: [],
    warnings: [],
    blockedByGuest: null,
    ...over,
  } as AvailabilityData["rooms"][number];
}

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function show() {
  return render(
    <Wrap>
      <FreeScreen />
    </Wrap>,
  );
}

beforeEach(() => {
  calls.length = 0;
  result = {
    checkin: iso("2030-06-10"),
    checkout: iso("2030-06-12"),
    guests: 2,
    unassignedBookings: 0,
    rooms: [
      room({ roomId: "r1", name: "Cosmos", recommended: true, reasons: ["FITS_PARTY"] }),
      room({ roomId: "r2", name: "Iris" }),
      room({ roomId: "r3", name: "Onar", available: false, reasons: ["ROOM_TAKEN"], blockedByGuest: "Nikos P" }),
      room({ roomId: "r4", name: "Helios", available: false, reasons: ["ROOM_CLOSED"] }),
    ],
  };
});

describe("FreeScreen", () => {
  it("starts from today, 2 nights, 2 guests and lists free then busy apartments", async () => {
    show();
    expect(await screen.findByText("Ελεύθερα: 2 από 4")).toBeInTheDocument();
    expect(screen.getByLabelText("Άφιξη")).toHaveValue("2030-06-10");
    expect(screen.getByLabelText("Αναχώρηση")).toHaveValue("2030-06-12");
    expect(screen.queryByLabelText("Νύχτες")).not.toBeInTheDocument();
    expect(screen.getByText(/· 2 νύχτες/)).toBeInTheDocument();
    expect(calls.at(-1)).toEqual({ checkin: "2030-06-10", checkout: "2030-06-12", guests: 2 });

    const free = within(screen.getByRole("region", { name: "Ελεύθερα" }));
    const items = free.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Cosmos");
    expect(items[0]).toHaveTextContent("Προτείνεται: χωράει 2 άτομα");
    expect(items[1]).toHaveTextContent("Iris");
    expect(items[1]).toHaveTextContent("Ελεύθερο");

    const busy = within(screen.getByRole("region", { name: "Κλεισμένα" }));
    expect(busy.getByText("Κλεισμένο: Nikos P")).toBeInTheDocument();
    expect(busy.getByText("Κλειστό εκείνες τις μέρες")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Δείτε στο ημερολόγιο" })).toHaveAttribute("href", "/app/calendar");
  });

  it("counts the nights from the two dates, keeps them for a new arrival and re-asks when guests change", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText("Ελεύθερα: 2 από 4");

    fireEvent.change(screen.getByLabelText("Αναχώρηση"), { target: { value: "2030-06-15" } });
    await waitFor(() => expect(screen.getByText(/· 5 νύχτες/)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Ένα άτομο ακόμα" }));
    await waitFor(() => expect(calls.at(-1)).toEqual({ checkin: "2030-06-10", checkout: "2030-06-15", guests: 3 }));

    fireEvent.change(screen.getByLabelText("Άφιξη"), { target: { value: "2030-06-12" } });
    expect(screen.getByLabelText("Αναχώρηση")).toHaveValue("2030-06-17");
    await waitFor(() => expect(screen.getByText(/· 5 νύχτες/)).toBeInTheDocument());
  });

  it("warns about a small apartment and about bookings without an apartment", async () => {
    result = {
      ...result,
      guests: 5,
      unassignedBookings: 2,
      rooms: [room({ roomId: "r1", name: "Cosmos", capacity: 4, warnings: ["OVER_CAPACITY"] })],
    };
    show();
    expect(
      await screen.findByText("Προσοχή: 2 κρατήσεις αυτές τις μέρες δεν έχουν ακόμα διαμέρισμα"),
    ).toBeInTheDocument();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const user = userEvent.setup();
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Ένα άτομο ακόμα" }));
    expect(await screen.findByText("Μικρό για 5 άτομα (χωράει 4)")).toBeInTheDocument();
  });

  it("says so when nothing is free", async () => {
    result = {
      ...result,
      rooms: [room({ roomId: "r3", name: "Onar", available: false, reasons: ["ROOM_TAKEN"], blockedByGuest: null })],
    };
    show();
    expect(await screen.findByText("Κανένα διαμέρισμα δεν είναι ελεύθερο αυτές τις μέρες.")).toBeInTheDocument();
    expect(screen.getByText("Κλεισμένο")).toBeInTheDocument();
  });
});

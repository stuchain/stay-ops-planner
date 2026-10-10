import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import type { ArrangeProposal, CalendarRoom } from "@/api/types";
import { ArrangeMonthPanel } from "@/features/calendar/ArrangeMonthPanel";
import { render, screen, waitFor } from "../intl";

const iso = (s: string) => s as IsoDate;

let proposal: ArrangeProposal;
const applyFn = vi.fn();

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    calendar: {
      arrangePreview: {
        queryOptions: (input: { month: string }) => ({
          queryKey: ["calendar.arrangePreview", input],
          queryFn: async () => proposal,
        }),
      },
      arrangeApply: { mutationOptions: () => ({ mutationFn: (input: unknown) => applyFn(input) }) },
      range: { pathKey: () => ["calendar.range"] },
    },
    booking: { suggestions: { pathKey: () => ["booking.suggestions"] } },
  }),
}));

vi.mock("@/ui/Toast", () => ({ showToast: vi.fn() }));

const ROOMS: CalendarRoom[] = [
  { id: "onar", name: "Onar", color: "#0F766E", capacity: 2, preferredForLargeParty: false, isActive: true },
  { id: "cosmos", name: "Cosmos", color: "#7C3AED", capacity: 4, preferredForLargeParty: true, isActive: true },
];

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function show(onPreview = vi.fn(), onClose = vi.fn()) {
  render(
    <Wrap>
      <div id="new-ui-root">
        <ArrangeMonthPanel month={iso("2030-07-01")} rooms={ROOMS} onPreview={onPreview} onClose={onClose} />
      </div>
    </Wrap>,
  );
  return { onPreview, onClose };
}

describe("ArrangeMonthPanel", () => {
  beforeEach(() => {
    applyFn.mockReset();
    proposal = {
      month: iso("2030-07-01"),
      placements: [
        {
          bookingId: "b1",
          version: 3,
          guestName: "Maria",
          checkin: iso("2030-07-02"),
          checkout: iso("2030-07-05"),
          partySize: 4,
          roomId: "cosmos",
          reasons: ["FREE", "FITS_PARTY", "LARGE_PARTY_ROOM"],
          warnings: [],
        },
        {
          bookingId: "b2",
          version: 0,
          guestName: "Nikos",
          checkin: iso("2030-07-10"),
          checkout: iso("2030-07-12"),
          partySize: 3,
          roomId: "onar",
          reasons: ["FREE", "OVER_CAPACITY"],
          warnings: ["OVER_CAPACITY"],
        },
      ],
      unplaced: [
        { bookingId: "b3", guestName: "Eleni", checkin: iso("2030-07-03"), checkout: iso("2030-07-04"), partySize: 2 },
      ],
    };
  });

  it("shows each placement with its reason, the ones that fit nowhere, and highlights the plan", async () => {
    const { onPreview } = show();
    expect(await screen.findByText("Maria")).toBeInTheDocument();
    expect(screen.getByText("Προτείνεται: χωράει 4 άτομα")).toBeInTheDocument();
    expect(screen.getByText(/2 κρατήσεις θα μπουν σε διαμέρισμα/)).toBeInTheDocument();
    expect(screen.getByText(/1 κράτηση δεν χωράει πουθενά/)).toBeInTheDocument();
    expect(screen.getByText("Eleni")).toBeInTheDocument();
    await waitFor(() =>
      expect(onPreview).toHaveBeenLastCalledWith(
        new Map([
          ["b1", "cosmos"],
          ["b2", "onar"],
        ]),
      ),
    );
  });

  it("applies exactly the preview with the versions seen, then closes", async () => {
    applyFn.mockResolvedValue({ placed: 2 });
    const { onClose } = show();
    await userEvent.click(await screen.findByRole("button", { name: "Εφαρμογή (2 κρατήσεις)" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(applyFn).toHaveBeenCalledWith({
      placements: [
        { bookingId: "b1", roomId: "cosmos", expectedVersion: 3 },
        { bookingId: "b2", roomId: "onar", expectedVersion: 0 },
      ],
    });
  });

  it("says so when every booking of the month already has an apartment", async () => {
    proposal = { month: iso("2030-07-01"), placements: [], unplaced: [] };
    show();
    expect(await screen.findByText("Όλες οι κρατήσεις αυτού του μήνα έχουν ήδη διαμέρισμα.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Εφαρμογή/ })).not.toBeInTheDocument();
  });
});

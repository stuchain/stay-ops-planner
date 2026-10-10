import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { RecommenderScreen } from "@/features/dev/RecommenderScreen";
import { latinWords, render, screen, waitFor, within } from "../intl";

const DEFAULT_RULES = ["free", "capacity", "partyRoom", "bookedRoom", "gaps", "roomOrder"].map((rule) => ({
  rule,
  weight: 1,
}));

const saveCalls: unknown[] = [];
const debugInputs: unknown[] = [];

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    dev: {
      apartments: {
        list: {
          queryOptions: () => ({
            queryKey: ["apartments"],
            queryFn: async () => [
              { id: "r1", name: "Onar" },
              { id: "r2", name: "Cosmos" },
            ],
          }),
        },
      },
      recommender: {
        config: {
          queryKey: () => ["config"],
          queryOptions: () => ({ queryKey: ["config"], queryFn: async () => ({ rules: DEFAULT_RULES }) }),
        },
        save: {
          mutationOptions: () => ({
            mutationFn: async (input: unknown) => {
              saveCalls.push(input);
              return input;
            },
          }),
        },
        reset: { mutationOptions: () => ({ mutationFn: async () => ({ rules: DEFAULT_RULES }) }) },
        bookings: {
          queryOptions: () => ({
            queryKey: ["bookings"],
            queryFn: async () => [
              {
                id: "b1",
                guestName: "Maria Papadopoulou",
                checkin: "2030-06-10",
                checkout: "2030-06-13",
                partySize: 2,
                needsApartment: true,
              },
            ],
          }),
        },
        debug: {
          pathKey: () => ["debug"],
          queryOptions: (input: unknown) => {
            debugInputs.push(input);
            return {
              queryKey: ["debug", input],
              queryFn: async () => [
                {
                  roomId: "r1",
                  available: true,
                  blockedBy: null,
                  blockedByGuest: null,
                  recommended: true,
                  reasons: ["FREE", "FITS_PARTY"],
                  warnings: [],
                  contributions: DEFAULT_RULES.map((r, i) => ({ rule: r.rule, raw: i, value: i })),
                },
                {
                  roomId: "r2",
                  available: false,
                  blockedBy: null,
                  blockedByGuest: "Nikos P.",
                  recommended: false,
                  reasons: ["ROOM_TAKEN"],
                  warnings: [],
                  contributions: DEFAULT_RULES.map((r) => ({ rule: r.rule, raw: 1, value: 1 })),
                },
              ],
            };
          },
        },
      },
    },
  }),
}));

function show(locale: "el" | "en" = "el") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <Wrap>
      <RecommenderScreen />
    </Wrap>,
    { locale },
  );
}

describe("RecommenderScreen", () => {
  it("shows the rules, then every apartment with each rule's contribution once a booking is picked", async () => {
    const user = userEvent.setup();
    const { container } = show();
    expect(await screen.findByRole("heading", { name: "Κανόνες με σειρά προτεραιότητας" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Maria Papadopoulou/ }));

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("Onar")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Προτείνεται")).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/Δεν είναι διαθέσιμο \(Nikos P\.\)/)).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4 + DEFAULT_RULES.length);
    expect(latinWords(container.textContent ?? "", ["Maria", "Papadopoulou", "Nikos", "P."])).toEqual([]);
  });

  it("saves a changed order and tries it in the preview before saving", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: /Maria Papadopoulou/ }));
    await screen.findByRole("table");

    const save = screen.getByRole("button", { name: "Αποθήκευση" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Μετακίνηση του κανόνα «Σειρά στο ημερολόγιο» πιο πάνω" }));
    expect(await screen.findByText(/δεν έχουν αποθηκευτεί/)).toBeInTheDocument();
    await waitFor(() => {
      const last = debugInputs.at(-1) as { config: { rules: { rule: string }[] } };
      expect(last.config.rules.map((r) => r.rule).slice(-2)).toEqual(["roomOrder", "gaps"]);
    });

    await user.click(save);
    await waitFor(() => expect(saveCalls).toHaveLength(1));
    expect((saveCalls[0] as { config: { rules: { rule: string }[] } }).config.rules[4]!.rule).toBe("roomOrder");
    expect(screen.getByRole("button", { name: "Επαναφορά προεπιλογών" })).toBeInTheDocument();
  });

  it("renders in English too", async () => {
    show("en");
    expect(await screen.findByRole("button", { name: "Restore defaults" })).toBeInTheDocument();
  });
});

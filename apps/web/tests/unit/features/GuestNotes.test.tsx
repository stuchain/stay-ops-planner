// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import { cleanup, latinWords, render, screen, waitFor } from "../intl";
import type { PreviousStays } from "@/api/types";
import { GuestNotes } from "@/features/calendar/GuestNotes";

const calls = vi.hoisted(() => ({ save: vi.fn(), previous: vi.fn() }));

vi.mock("@/api/client", () => {
  const key = (name: string) => () => [name];
  const trpc = {
    today: { summary: { pathKey: key("today") } },
    booking: {
      details: { pathKey: key("details") },
      history: { pathKey: key("history") },
      previousStays: {
        queryOptions: (input: { bookingId: string }) => ({
          queryKey: ["previousStays", input.bookingId],
          queryFn: async () => calls.previous(),
        }),
      },
      setGuestNote: { mutationOptions: () => ({ mutationFn: async (input: unknown) => calls.save(input) }) },
    },
  };
  return { useTRPC: () => trpc };
});

vi.mock("@/ui/Toast", () => ({ showToast: vi.fn() }));

afterEach(cleanup);

const stay = (checkin: string, apartment: string, note: string | null) => ({
  bookingId: checkin,
  checkin: checkin as IsoDate,
  apartment,
  note,
});

beforeEach(() => {
  calls.save.mockReset().mockImplementation(async (input: { note: string }) => ({ guestNote: input.note }));
  calls.previous.mockReset().mockResolvedValue({ sure: [], maybe: [] } satisfies PreviousStays);
});

function show(note: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GuestNotes bookingId="b1" note={note} />
    </QueryClientProvider>,
  );
}

describe("GuestNotes", () => {
  it("shows the notes from the guest's earlier stays, sure ones and same-name ones apart", async () => {
    calls.previous.mockResolvedValue({
      sure: [stay("2025-08-03", "Cosmos", "Πληρώνει με την άφιξη"), stay("2025-07-01", "Onar", null)],
      maybe: [stay("2024-05-10", "Iris", "Θόρυβος αργά")],
    } satisfies PreviousStays);
    const { container } = show(null);
    expect(await screen.findByText("Πληρώνει με την άφιξη")).toBeTruthy();
    expect(screen.getByText("Σημειώσεις από προηγούμενες διαμονές")).toBeTruthy();
    expect(screen.getByText("Cosmos, Αύγουστος 2025")).toBeTruthy();
    expect(screen.getByText("Θόρυβος αργά")).toBeTruthy();
    expect(screen.getByText("Σημειώσεις από διαμονές με το ίδιο όνομα (ίσως άλλος επισκέπτης)")).toBeTruthy();
    expect(latinWords(container.textContent ?? "", ["Cosmos", "Onar", "Iris"])).toEqual([]);
  });

  it("saves this booking's note only once it changed", async () => {
    const user = userEvent.setup();
    show("Ήσυχοι");
    const box = screen.getByRole("textbox", { name: "Σημείωση για τον επισκέπτη" });
    expect(box).toHaveValue("Ήσυχοι");
    expect(screen.queryByRole("button", { name: "Αποθήκευση σημείωσης" })).toBeNull();
    await user.type(box, ", ευγενικοί");
    await user.click(screen.getByRole("button", { name: "Αποθήκευση σημείωσης" }));
    await waitFor(() => expect(calls.save).toHaveBeenCalled());
    expect(calls.save.mock.calls[0]![0]).toEqual({ bookingId: "b1", note: "Ήσυχοι, ευγενικοί" });
  });
});

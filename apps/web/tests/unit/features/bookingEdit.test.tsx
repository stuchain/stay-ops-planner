// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, latinWords, render, screen, waitFor } from "../intl";
import type { BookingDetails, CalendarBooking } from "@/api/types";
import { BookingEdit } from "@/features/calendar/BookingEdit";
import { BookingPrice } from "@/features/calendar/BookingPrice";
import { useUnsavedGuard } from "@/features/calendar/useUnsavedGuard";

const calls = vi.hoisted(() => ({ update: vi.fn(), reset: vi.fn() }));

vi.mock("@/api/client", () => {
  const key = (name: string) => () => [name];
  const trpc = {
    calendar: { range: { pathKey: key("range") } },
    booking: {
      details: { pathKey: key("details") },
      history: { pathKey: key("history") },
      updateDetails: { mutationOptions: () => ({ mutationFn: async (input: unknown) => calls.update(input) }) },
      resetField: { mutationOptions: () => ({ mutationFn: async (input: unknown) => calls.reset(input) }) },
    },
  };
  return { useTRPC: () => trpc };
});

vi.mock("@/ui/Toast", () => ({ showToast: vi.fn() }));

afterEach(cleanup);
beforeEach(() => {
  calls.update.mockReset().mockResolvedValue({ version: 4 });
  calls.reset.mockReset().mockResolvedValue({ version: 4 });
});

const booking = {
  id: "b1",
  version: 3,
  guestName: "Μαρία Παπαδοπούλου",
  partySize: 5,
} as CalendarBooking;

const details = (over: Partial<BookingDetails> = {}): BookingDetails =>
  ({
    notes: "Αργά το βράδυ",
    price: null,
    local: { guestName: null, partySize: null, notes: null },
    ...over,
  }) as BookingDetails;

function renderEdit(d: BookingDetails, onDirtyChange: (dirty: boolean) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BookingEdit booking={booking} details={d} onDirtyChange={onDirtyChange} />
    </QueryClientProvider>,
  );
}

describe("BookingEdit", () => {
  it("shows the values and reveals big inputs with Αλλαγή", async () => {
    const user = userEvent.setup();
    const { container } = renderEdit(details());
    expect(screen.getByText("Μαρία Παπαδοπούλου")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Αλλαγή" }));
    expect(screen.getByLabelText("Όνομα επισκέπτη")).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Άτομα" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Αποθήκευση" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Άκυρο" })).toBeTruthy();
    expect(latinWords(container.textContent ?? "")).toEqual([]);
  });

  it("saves only what changed, with the version the screen showed", async () => {
    const user = userEvent.setup();
    renderEdit(details());
    await user.click(screen.getByRole("button", { name: "Αλλαγή" }));
    const people = screen.getByRole("spinbutton", { name: "Άτομα" });
    await user.clear(people);
    await user.type(people, "4");
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(calls.update).toHaveBeenCalled());
    expect(calls.update.mock.calls[0]![0]).toEqual({ bookingId: "b1", expectedVersion: 3, partySize: 4 });
  });

  it("will not save an empty name or an impossible number of people", async () => {
    const user = userEvent.setup();
    renderEdit(details());
    await user.click(screen.getByRole("button", { name: "Αλλαγή" }));
    await user.clear(screen.getByLabelText("Όνομα επισκέπτη"));
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    expect(screen.getByText("Γράψτε ένα όνομα.")).toBeTruthy();
    expect(calls.update).not.toHaveBeenCalled();
  });

  it("shows «Από Hosthub» under a changed field and restores it with Επαναφορά", async () => {
    const user = userEvent.setup();
    renderEdit(details({ local: { guestName: { hosthub: "Maria P." }, partySize: null, notes: null } }));
    expect(screen.getByText("Από το Hosthub: Maria P.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Επαναφορά: Όνομα επισκέπτη" }));
    await waitFor(() => expect(calls.reset).toHaveBeenCalled());
    expect(calls.reset.mock.calls[0]![0]).toEqual({ bookingId: "b1", field: "guestName", expectedVersion: 3 });
  });

  it("tells the screen when there are unsaved changes", async () => {
    const user = userEvent.setup();
    const onDirty = vi.fn();
    renderEdit(details(), onDirty);
    await user.click(screen.getByRole("button", { name: "Αλλαγή" }));
    expect(onDirty).toHaveBeenLastCalledWith(false);
    await user.type(screen.getByLabelText("Σημειώσεις"), " ξανά");
    expect(onDirty).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Άκυρο" }));
    expect(onDirty).toHaveBeenLastCalledWith(false);
  });
});

describe("BookingPrice", () => {
  it("shows the total and the net in words, with the rest behind Λεπτομέρειες", () => {
    const { container } = render(
      <BookingPrice
        price={{
          kind: "confirmed",
          totalCents: 50000,
          netCents: 42000,
          channelFeeCents: 8000,
          cleaningFeeCents: 3000,
          taxCents: null,
          guestPaidCents: null,
          foreignCurrency: false,
          currency: "EUR",
        }}
      />,
    );
    expect(screen.getByText("Σύνολο")).toBeTruthy();
    expect(screen.getByText("Καθαρά για εσάς")).toBeTruthy();
    expect(screen.getByText("Λεπτομέρειες")).toBeTruthy();
    expect(screen.getByText("Προμήθεια πλατφόρμας")).toBeTruthy();
    expect(screen.queryByText("Φόροι")).toBeNull();
    expect(latinWords(container.textContent ?? "")).toEqual([]);
  });

  it("says so when there is no price", () => {
    render(<BookingPrice price={null} />);
    expect(screen.getByText("Το Hosthub δεν έστειλε τιμή για αυτή την κράτηση.")).toBeTruthy();
  });
});

function GuardHarness({ dirty }: { dirty: boolean }) {
  const { setDirty, run, dialog } = useUnsavedGuard();
  setDirty(dirty);
  return (
    <div>
      <button onClick={() => run(() => document.title === "x" || (document.body.dataset.went = "yes"))}>Αλλο</button>
      {dialog}
    </div>
  );
}

describe("unsaved changes guard", () => {
  beforeEach(() => {
    delete document.body.dataset.went;
  });

  it("does the action at once when nothing is unsaved", async () => {
    const user = userEvent.setup();
    render(<GuardHarness dirty={false} />);
    await user.click(screen.getByRole("button", { name: "Αλλο" }));
    expect(document.body.dataset.went).toBe("yes");
  });

  it("asks first when there are unsaved changes: staying keeps them, continuing goes on", async () => {
    const user = userEvent.setup();
    render(<GuardHarness dirty />);
    await user.click(screen.getByRole("button", { name: "Αλλο" }));
    expect(screen.getByText("Έχετε αλλαγές που δεν αποθηκεύτηκαν")).toBeTruthy();
    expect(document.body.dataset.went).toBeUndefined();

    await user.click(screen.getByRole("button", { name: "Να μείνω εδώ" }));
    expect(document.body.dataset.went).toBeUndefined();
    expect(screen.queryByText("Έχετε αλλαγές που δεν αποθηκεύτηκαν")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Αλλο" }));
    await user.click(screen.getByRole("button", { name: "Συνέχεια χωρίς αποθήκευση" }));
    expect(document.body.dataset.went).toBe("yes");
  });

  it("the browser asks before the page is left, only while there are unsaved changes", () => {
    const { rerender } = render(<GuardHarness dirty />);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    rerender(<GuardHarness dirty={false} />);
    const calm = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(calm);
    expect(calm.defaultPrevented).toBe(false);
  });
});

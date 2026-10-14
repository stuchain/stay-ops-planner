// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import { cleanup, render, screen, within } from "../intl";
import type { BookingDetails, CalendarBooking, CalendarRoom, Suggestion } from "@/api/types";
import { BookingPanel } from "@/features/calendar/BookingPanel";
import { DEFAULT_TEMPLATES } from "@/i18n/guestMessages/defaults";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/ui/Toast", () => ({ showToast: vi.fn(), undoToast: vi.fn() }));

const SUGGESTIONS: Suggestion[] = [
  { roomId: "onar", available: true, recommended: true, reasons: ["FREE"], warnings: [], blockedByGuest: null },
  { roomId: "iris", available: true, recommended: false, reasons: ["FREE"], warnings: [], blockedByGuest: null },
  {
    roomId: "cosmos",
    available: false,
    recommended: false,
    reasons: ["OVERLAP"],
    warnings: [],
    blockedByGuest: "Anna Papadopoulou",
  },
] as unknown as Suggestion[];

vi.mock("@/api/client", () => {
  const key = (name: string) => () => [name];
  const query = (name: string, data: () => unknown) => ({
    queryOptions: (input?: { bookingId: string }) => ({
      queryKey: [name, input?.bookingId],
      queryFn: async () => data(),
    }),
    pathKey: key(name),
  });
  const trpc = {
    calendar: { range: { pathKey: key("range") } },
    today: { summary: { pathKey: key("today") } },
    booking: {
      details: query("details", () => DETAILS),
      previousStays: query("previous", () => ({ sure: [], maybe: [] })),
      suggestions: query("suggestions", () => SUGGESTIONS),
      history: query("history", () => []),
      messageTemplates: query("templates", () => ({ overrides: [], defaults: DEFAULT_TEMPLATES })),
      updateDetails: { mutationOptions: () => ({ mutationFn: async () => ({ version: 2 }) }) },
      resetField: { mutationOptions: () => ({ mutationFn: async () => ({ version: 2 }) }) },
      setGuestNote: { mutationOptions: () => ({ mutationFn: async () => ({ guestNote: null }) }) },
    },
  };
  return { useTRPC: () => trpc };
});

const DETAILS = {
  notes: null,
  phone: "+30 691 234 5678",
  guestNote: null,
  price: { kind: "confirmed", totalCents: 90000, netCents: 80000, foreignCurrency: false, currency: "EUR" },
  local: { guestName: null, partySize: null, notes: null },
} as unknown as BookingDetails;

const ROOMS = [
  { id: "onar", name: "Onar", color: "#2E7D6B", capacity: 4, isActive: true },
  { id: "iris", name: "Iris", color: "#6B4FA0", capacity: 3, isActive: true },
  { id: "cosmos", name: "Cosmos", color: "#C2562E", capacity: 4, isActive: true },
] as CalendarRoom[];

const booking = (over: Partial<CalendarBooking> = {}) => {
  const b = {
    id: "b1",
    version: 1,
    guestName: "Olivia Brown",
    checkin: "2030-10-19" as IsoDate,
    checkout: "2030-10-24" as IsoDate,
    nights: 5,
    partySize: 3,
    channel: "airbnb",
    status: "confirmed",
    assignment: null,
    ...over,
  } as CalendarBooking;
  // The apartment's nights follow the assignment unless a test gives its own pieces.
  return {
    ...b,
    pieces: over.pieces ?? (b.assignment ? [{ roomId: b.assignment.roomId, start: b.checkin, end: b.checkout }] : []),
  };
};

afterEach(cleanup);

function show(b: CalendarBooking, onMove = vi.fn(), onDirtyChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BookingPanel
        booking={b}
        rooms={ROOMS}
        today={"2030-10-01" as IsoDate}
        confirm={null}
        moving={false}
        onMove={onMove}
        onCancelConfirm={() => {}}
        onClose={() => {}}
        onDirtyChange={onDirtyChange}
      />
    </QueryClientProvider>,
  );
  return screen.getByRole("dialog");
}

const row = (panel: HTMLElement, name: string | RegExp) => within(panel).getByRole("button", { name });

describe("BookingPanel", () => {
  it("puts the facts on one line and the apartment choice first, the rest folded", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const panel = show(booking(), onMove);

    expect(within(panel).getByRole("heading", { name: "Olivia Brown" })).toBeTruthy();
    expect(panel.textContent).toContain("Από: Airbnb");
    expect(panel.textContent).toContain("3 άτομα");
    expect(panel.textContent).not.toContain("Κανάλι");
    expect(within(panel).getByRole("heading", { name: "Σε ποιο διαμέρισμα;" })).toBeTruthy();

    const best = await within(panel).findByRole("button", { name: /^Μετακίνηση στο Onar\./ });
    expect(best.dataset.recommended).toBe("true");
    expect(best.textContent).toContain("Εδώ");
    const busy = within(panel).getByRole("button", { name: "Μετακίνηση στο Cosmos. Κλεισμένο: Anna Papadopoulou" });
    expect(busy).toBeDisabled();
    expect(busy.textContent).not.toContain("Εδώ");

    // The folded rows, in order, all closed.
    await within(panel).findByRole("button", { name: "Στείλτε μήνυμα" });
    const folds = within(panel)
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("aria-expanded"))
      .map((b) => [b.textContent, b.getAttribute("aria-expanded")]);
    expect(folds).toEqual([
      ["Στείλτε μήνυμα", "false"],
      ["Σημείωση για τον επισκέπτη", "false"],
      [expect.stringMatching(/^Τιμή · 900\s€$/), "false"],
      ["Αλλαγή στοιχείων", "false"],
      ["Τι έγινε", "false"],
    ]);
    expect(within(panel).getByRole("link", { name: /Κάρτα άφιξης/ })).toBeTruthy();
    expect(within(panel).queryByRole("textbox", { name: "Το μήνυμα" })).toBeNull();

    await user.click(row(panel, "Στείλτε μήνυμα"));
    expect(row(panel, "Στείλτε μήνυμα").getAttribute("aria-expanded")).toBe("true");
    const text = (await within(panel).findByRole("textbox", { name: "Το μήνυμα" })) as HTMLTextAreaElement;
    // A +30 phone starts the message in Greek.
    expect(within(panel).getByRole("radio", { name: "Ελληνικά" })).toBeChecked();
    expect(text.value).not.toBe("");

    await user.click(best);
    expect(onMove).toHaveBeenCalledWith({ booking: expect.objectContaining({ id: "b1" }), roomId: "onar" });
  });

  it("says which apartment a placed booking is in and shows the list only on Αλλαγή διαμερίσματος", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const panel = show(
      booking({ assignment: { roomId: "cosmos", pinned: false } } as Partial<CalendarBooking>),
      onMove,
    );

    expect(within(panel).getByRole("heading", { name: "Στο Cosmos" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /^Μετακίνηση στο / })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Βγάλτε την από το διαμέρισμα" })).toBeNull();

    await user.click(row(panel, "Αλλαγή διαμερίσματος"));
    expect(await within(panel).findByRole("button", { name: /^Μετακίνηση στο Onar\./ })).toBeEnabled();
    await user.click(row(panel, "Βγάλτε την από το διαμέρισμα"));
    expect(onMove).toHaveBeenCalledWith({ booking: expect.objectContaining({ id: "b1" }), roomId: null });
  });

  it("keeps Αλλαγή στοιχείων open while the form has unsaved changes", async () => {
    const user = userEvent.setup();
    const onDirty = vi.fn();
    const panel = show(booking(), vi.fn(), onDirty);

    await user.click(await within(panel).findByRole("button", { name: "Αλλαγή στοιχείων" }));
    await user.click(row(panel, "Αλλαγή"));
    await user.type(within(panel).getByLabelText("Όνομα επισκέπτη"), " Jr");
    expect(onDirty).toHaveBeenLastCalledWith(true);

    await user.click(row(panel, "Αλλαγή στοιχείων"));
    expect(row(panel, "Αλλαγή στοιχείων").getAttribute("aria-expanded")).toBe("true");
    expect(within(panel).getByLabelText("Όνομα επισκέπτη")).toBeVisible();

    await user.click(row(panel, "Άκυρο"));
    expect(onDirty).toHaveBeenLastCalledWith(false);
    await user.click(row(panel, "Αλλαγή στοιχείων"));
    expect(row(panel, "Αλλαγή στοιχείων").getAttribute("aria-expanded")).toBe("false");
  });
});

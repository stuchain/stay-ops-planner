import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import type { TurnoverList, TurnoverTask } from "@/api/types";
import { TurnoversScreen } from "@/features/turnovers/TurnoversScreen";
import { Toaster } from "@/ui/Toast";
import { render, screen, within } from "../intl";

const iso = (s: string) => s as IsoDate;

let listResult: TurnoverList;
let role: "viewer" | "operator";
const listInputs: unknown[] = [];
const calls: Array<{ name: string; input: unknown }> = [];

vi.mock("@/api/client", () => {
  const mutation = (name: string) => ({
    mutationOptions: () => ({
      mutationFn: async (input: unknown) => {
        calls.push({ name, input });
        if (name === "createLink") return { path: "/c/TOKEN", expiresAt: "2030-06-17T00:00:00.000Z" };
        return name === "remove" ? { version: "2030-06-09T11:00:00.000Z" } : { ok: true };
      },
    }),
  });
  return {
    useTRPC: () => ({
      me: { get: { queryOptions: () => ({ queryKey: ["me"], queryFn: async () => ({ role }) }) } },
      cleaning: {
        pathKey: () => ["cleaning"],
        list: {
          pathKey: () => ["cleaning.list"],
          queryOptions: (input: unknown) => {
            listInputs.push(input);
            return { queryKey: ["cleaning.list", input], queryFn: async () => listResult };
          },
        },
        setStatus: mutation("setStatus"),
        remove: mutation("remove"),
        restore: mutation("restore"),
        createLink: mutation("createLink"),
      },
    }),
  };
});

function task(over: Partial<TurnoverTask> & Pick<TurnoverTask, "id">): TurnoverTask {
  return {
    day: iso("2030-06-10"),
    status: "todo",
    taskType: "turnover",
    room: { id: "r1", name: "Onar", label: "1 - Onar", color: "#0F766E" },
    leaving: { guestName: "Maria Papadopoulou", time: "11:00" },
    next: { checkin: iso("2030-06-10"), time: "15:00", party: { adults: 2, children: 1, infants: 1 }, sameDay: true },
    guest: { name: "Nikos Georgiou", party: { adults: 2, children: 1, infants: 1 } },
    start: "11:00",
    end: "13:00",
    assigneeName: null,
    notes: null,
    version: "2030-06-09T10:00:00.000Z",
    conflictsWith: [],
    kind: "AA",
    movable: null,
    ...over,
  };
}

function list(tasks: TurnoverTask[], cancelledCount = 0): TurnoverList {
  return { today: iso("2030-06-10"), from: iso("2030-06-10"), to: iso("2030-06-17"), tasks, cancelledCount };
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <Wrap>
      <TurnoversScreen />
      <Toaster />
    </Wrap>,
  );
}

beforeEach(() => {
  // sonner's toast asks for pointer capture, which jsdom lacks.
  Element.prototype.setPointerCapture = () => {};
  role = "operator";
  calls.length = 0;
  listInputs.length = 0;
});

describe("TurnoversScreen", () => {
  it("shows a card for a day with cleanings, one line per cleaning, and one grey line for the empty days", async () => {
    listResult = list([task({ id: "t1" })]);
    show();
    expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent("Σήμερα");
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    const item = screen.getByRole("listitem");
    // The numbered apartment, the kind and who comes; babies count as children. No times, no who leaves.
    expect(item).toHaveTextContent("1 - Onar");
    expect(item).toHaveTextContent("A-A");
    expect(item).toHaveTextContent("Nikos Georgiou · 2 ενήλικες, 2 παιδιά");
    expect(item.textContent).not.toMatch(/\d{2}:\d{2}/);
    expect(item).not.toHaveTextContent("Maria");
    expect(screen.queryByText("Δεν έχει γίνει")).not.toBeInTheDocument();
    const empty = screen.getAllByTestId("turnovers-empty-days");
    expect(empty).toHaveLength(1);
    expect(empty[0]).toHaveTextContent("Αύριο έως Κυρ 16 Ιουν: δεν έχει καθάρισμα.");
  });

  it("joins today and tomorrow into one sentence when both are empty", async () => {
    listResult = list([task({ id: "t1", day: iso("2030-06-12") }), task({ id: "t2", day: iso("2030-06-16") })]);
    show();
    await screen.findAllByRole("listitem");
    const empty = screen.getAllByTestId("turnovers-empty-days").map((p) => p.textContent);
    expect(empty).toEqual(["Σήμερα και αύριο δεν έχει καθάρισμα.", "Πεμ 13 Ιουν έως Σαβ 15 Ιουν: δεν έχει καθάρισμα."]);
  });

  it("shows who is staying for a service, and says when nobody is booked after an A", async () => {
    listResult = list([
      task({
        id: "t1",
        kind: "S",
        taskType: "service",
        guest: { name: "Anna Lind", party: { adults: 1, children: 0, infants: 0 } },
      }),
      task({ id: "t2", kind: "A", room: { id: "r2", name: "Iris", label: "3 - Iris", color: null }, guest: null }),
    ]);
    show();
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("S");
    expect(items[0]).toHaveTextContent("Anna Lind · 1 ενήλικας");
    expect(items[1]).toHaveTextContent("3 - Iris");
    expect(items[1]).toHaveTextContent("Δεν έχει κράτηση ακόμα");
  });

  it("removes an A with the red × and offers Undo; an A-A has no ×", async () => {
    listResult = list([task({ id: "t1" }), task({ id: "t2", kind: "A" })]);
    show();
    const buttons = await screen.findAllByTestId("cleaning-remove");
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        name: "remove",
        input: { id: "t2", expectedVersion: "2030-06-09T10:00:00.000Z" },
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Αναίρεση" }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        name: "restore",
        input: { id: "t2", expectedVersion: "2030-06-09T11:00:00.000Z" },
      }),
    );
  });

  it("marks a cleaning done with the version it was looking at", async () => {
    listResult = list([task({ id: "t1" })]);
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Έγινε" }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        name: "setStatus",
        input: { id: "t1", expectedVersion: "2030-06-09T10:00:00.000Z", status: "done" },
      }),
    );
  });

  it("shows a done cleaning in green with a small undo", async () => {
    listResult = list([task({ id: "t1", status: "done" })]);
    show();
    expect(await screen.findByRole("button", { name: "Δεν έγινε ακόμα" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Έγινε" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("cleaning-remove")).not.toBeInTheDocument();
  });

  it("still says when a cleaning is under way", async () => {
    listResult = list([task({ id: "t1", status: "in_progress" })]);
    show();
    expect(await screen.findByText("Γίνεται τώρα")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Έγινε" })).toBeInTheDocument();
  });

  it("gives a viewer no buttons to change anything", async () => {
    role = "viewer";
    listResult = list([task({ id: "t1" })]);
    show();
    await screen.findAllByRole("listitem");
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: "Στείλτε το πρόγραμμα στην καθαρίστρια" })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Έγινε" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("cleaning-remove")).not.toBeInTheDocument();
  });

  it("hides cancelled cleanings until asked, and pages by week from today", async () => {
    listResult = list([task({ id: "t1" })], 2);
    show();
    const toggle = await screen.findByRole("button", { name: "Εμφάνιση ακυρωμένων (2)" });
    expect(listInputs[0]).toEqual({ page: 0, showCancelled: false });
    expect(screen.getAllByRole("button", { name: "Προηγούμενες μέρες" })[0]).toBeDisabled();
    await userEvent.click(toggle);
    expect(await screen.findByRole("button", { name: "Απόκρυψη ακυρωμένων" })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Επόμενες μέρες" })[0]!);
    await vi.waitFor(() => expect(listInputs).toContainEqual({ page: 1, showCancelled: true }));
  });

  it("prints a plain sheet: apartment, kind, who comes or stays, adults and children", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    listResult = list([
      task({ id: "t1" }),
      task({
        id: "t2",
        day: iso("2030-06-12"),
        kind: "S",
        taskType: "service",
        guest: { name: "Anna Lind", party: { adults: 1, children: 0, infants: 0 } },
      }),
    ]);
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Εκτύπωση" }));
    expect(screen.getAllByRole("button", { name: "Εκτύπωση" })).toHaveLength(1);
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
    const sheet = screen.getByTestId("cleaning-sheet");
    const tables = within(sheet).getAllByRole("table");
    expect(tables).toHaveLength(2);
    expect(
      within(tables[0]!)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Διαμέρισμα", "Είδος", "Ποιος έρχεται / μένει", "Ενήλικες", "Παιδιά"]);
    expect(
      within(tables[0]!)
        .getAllByRole("cell")
        .map((td) => td.textContent),
    ).toEqual(["1 - Onar", "A-A", "Nikos Georgiou", "2", "2"]);
    expect(
      within(tables[1]!)
        .getAllByRole("cell")
        .map((td) => td.textContent),
    ).toEqual(["1 - Onar", "S", "Anna Lind", "1", "0"]);
    expect(sheet.textContent).not.toMatch(/\d{2}:\d{2}/);
    expect(sheet).toHaveTextContent("Αναχώρηση και άφιξη");
  });

  it("sends the schedule of a chosen day to the cleaner, with copy and WhatsApp", async () => {
    listResult = list([task({ id: "t1" }), task({ id: "t2", day: iso("2030-06-12") })]);
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Στείλτε το πρόγραμμα στην καθαρίστρια" }));
    const panel = screen.getByTestId("cleaner-link-panel");
    const days = within(within(panel).getByRole("group", { name: "Για ποια μέρα;" })).getAllByRole("button");
    expect(days.map((b) => b.textContent)).toEqual(["Σήμερα", "Τετ 12 Ιουν"]);
    await userEvent.click(days[1]!);
    const field = await within(panel).findByRole("textbox", { name: "Σύνδεσμος για την καθαρίστρια" });
    expect((field as HTMLInputElement).value).toMatch(/\/c\/TOKEN$/);
    expect(calls).toContainEqual({ name: "createLink", input: { day: "2030-06-12" } });
    expect(within(panel).getByRole("button", { name: "Αντιγραφή συνδέσμου" })).toBeInTheDocument();
    const whatsapp = within(panel).getByRole("link", { name: "Άνοιγμα στο WhatsApp" });
    expect(whatsapp.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\?text=.*%2Fc%2FTOKEN$/);
    expect(screen.queryByRole("button", { name: "Σύνδεσμος για καθαρίστρια" })).not.toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import type { TurnoverList, TurnoverTask } from "@/api/types";
import { TurnoversScreen } from "@/features/turnovers/TurnoversScreen";
import { latinWords, render, screen, within } from "../intl";

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
        return name === "createLink" ? { path: "/c/TOKEN", expiresAt: "2030-06-17T00:00:00.000Z" } : { ok: true };
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
        setAssignee: mutation("setAssignee"),
        reschedule: mutation("reschedule"),
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
    room: { id: "r1", name: "Onar", color: "#0F766E" },
    leaving: { guestName: "Maria Papadopoulou", time: "11:00" },
    next: { checkin: iso("2030-06-10"), time: "15:00", party: { adults: 2, children: 1, infants: 1 }, sameDay: true },
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
    </Wrap>,
  );
}

beforeEach(() => {
  role = "operator";
  calls.length = 0;
  listInputs.length = 0;
});

describe("TurnoversScreen", () => {
  it("shows a card for a day with cleanings, one line per cleaning, and one grey line for the empty days", async () => {
    listResult = list([task({ id: "t1" })]);
    const { container } = show();
    expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent("Σήμερα");
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("Onar");
    expect(item).toHaveTextContent("Φεύγουν 11:00 · έρχονται 15:00 ίδια μέρα");
    expect(within(item).getByText("έρχονται 15:00 ίδια μέρα").tagName).toBe("STRONG");
    expect(screen.queryByText("Δεν έχει γίνει")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ξεκινάω" })).not.toBeInTheDocument();
    const empty = screen.getAllByTestId("turnovers-empty-days");
    expect(empty).toHaveLength(1);
    expect(empty[0]).toHaveTextContent("Αύριο έως Κυρ 16 Ιουν: δεν έχει καθάρισμα.");
    expect(latinWords(container.textContent ?? "", ["Onar"])).toEqual([]);
  });

  it("joins today and tomorrow into one sentence when both are empty", async () => {
    listResult = list([task({ id: "t1", day: iso("2030-06-12") }), task({ id: "t2", day: iso("2030-06-16") })]);
    show();
    await screen.findAllByRole("listitem");
    const empty = screen.getAllByTestId("turnovers-empty-days").map((p) => p.textContent);
    expect(empty).toEqual(["Σήμερα και αύριο δεν έχει καθάρισμα.", "Πεμ 13 Ιουν έως Σαβ 15 Ιουν: δεν έχει καθάρισμα."]);
  });

  it("names the day the next guests come when it is not the same day, or says nobody comes", async () => {
    listResult = list([
      task({
        id: "t1",
        next: { checkin: iso("2030-06-14"), time: "15:00", party: null, sameDay: false },
      }),
      task({ id: "t2", room: { id: "r2", name: "Iris", color: null }, next: null }),
    ]);
    show();
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Φεύγουν 11:00 · έρχονται Παρ 14 Ιουν");
    expect(items[1]).toHaveTextContent("Φεύγουν 11:00 · δεν έρχεται κανείς μετά");
  });

  it("keeps who leaves, who comes and the cleaning time behind Αλλαγή", async () => {
    listResult = list([task({ id: "t1" })]);
    show();
    const toggle = await screen.findByRole("button", { name: "Αλλαγή" });
    expect(screen.queryByText("Maria Papadopoulou · στις 11:00")).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Maria Papadopoulou · στις 11:00")).toBeInTheDocument();
    expect(screen.getByText("Την ίδια μέρα στις 15:00")).toBeInTheDocument();
    expect(screen.getByText("2 ενήλικες, 1 παιδί, 1 βρέφος")).toBeInTheDocument();
    expect(screen.getByLabelText("Από")).toHaveValue("11:00");
    expect(screen.getByLabelText("Έως")).toHaveValue("13:00");
  });

  it("changes the cleaning time with the version it was looking at", async () => {
    listResult = list([task({ id: "t1" })]);
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Αλλαγή" }));
    const from = screen.getByLabelText("Από");
    await userEvent.clear(from);
    await userEvent.type(from, "12:00");
    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση ώρας" }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        name: "reschedule",
        input: { id: "t1", expectedVersion: "2030-06-09T10:00:00.000Z", start: "12:00", end: "13:00" },
      }),
    );
  });

  it("says when nobody comes next", async () => {
    listResult = list([task({ id: "t1", next: null })]);
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Αλλαγή" }));
    expect(screen.getByText("Κανείς δεν έρχεται")).toBeInTheDocument();
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

  it("shows a done cleaning in green with a small undo, and no time change for it", async () => {
    listResult = list([task({ id: "t1", status: "done" })]);
    show();
    expect(await screen.findByRole("button", { name: "Δεν έγινε ακόμα" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Έγινε" })).not.toBeInTheDocument();
    expect(screen.getByText("Έγινε")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Αλλαγή" }));
    expect(screen.queryByLabelText("Από")).not.toBeInTheDocument();
    expect(screen.getByText("11:00 – 13:00")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Αλλαγή" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Λεπτομέρειες" }));
    expect(screen.getByText("Maria Papadopoulou · στις 11:00")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("saves who cleans", async () => {
    listResult = list([task({ id: "t1" })]);
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Αλλαγή" }));
    await userEvent.type(screen.getByRole("textbox", { name: /Ποιος καθαρίζει/ }), "Ελένη");
    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση ονόματος" }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        name: "setAssignee",
        input: { id: "t1", expectedVersion: "2030-06-09T10:00:00.000Z", assigneeName: "Ελένη" },
      }),
    );
  });

  it("warns when the same cleaner has another cleaning at the same time", async () => {
    listResult = list([task({ id: "t1", assigneeName: "Ελένη", conflictsWith: ["t2"] })]);
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Ελένη: υπάρχει άλλο καθάρισμα την ίδια ώρα.");
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

  it("prints the days on screen with one button at the top", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    listResult = list([task({ id: "t1" }), task({ id: "t2", day: iso("2030-06-12") })]);
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Εκτύπωση" }));
    expect(screen.getAllByRole("button", { name: "Εκτύπωση" })).toHaveLength(1);
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
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

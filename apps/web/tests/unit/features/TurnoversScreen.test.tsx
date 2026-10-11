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
  it("shows a section for each of 7 days and the facts of a cleaning, in Greek", async () => {
    listResult = list([task({ id: "t1" })]);
    const { container } = show();
    expect(await screen.findByText("Maria Papadopoulou · στις 11:00")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(7);
    expect(screen.getByText("Σήμερα")).toBeInTheDocument();
    expect(screen.getByText("Την ίδια μέρα στις 15:00")).toBeInTheDocument();
    expect(screen.getByText("2 ενήλικες, 1 παιδί, 1 βρέφος")).toBeInTheDocument();
    expect(screen.getByText("11:00 – 13:00")).toBeInTheDocument();
    expect(screen.getAllByText("Δεν υπάρχει καθάρισμα αυτή τη μέρα.")).toHaveLength(6);
    expect(latinWords(container.textContent ?? "", ["Maria", "Papadopoulou"])).toEqual([]);
  });

  it("says when nobody comes next", async () => {
    listResult = list([task({ id: "t1", next: null })]);
    show();
    expect(await screen.findByText("Κανείς δεν έρχεται")).toBeInTheDocument();
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

  it("offers to reopen a done cleaning, and no time change for it", async () => {
    listResult = list([task({ id: "t1", status: "done" })]);
    show();
    expect(await screen.findByRole("button", { name: "Δεν έγινε ακόμα" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Αλλαγή ώρας" })).not.toBeInTheDocument();
  });

  it("gives a viewer no buttons to change anything", async () => {
    role = "viewer";
    listResult = list([task({ id: "t1" })]);
    show();
    await screen.findByText("Maria Papadopoulou · στις 11:00");
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Σύνδεσμος για καθαρίστρια" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Έγινε" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Αλλαγή" })).not.toBeInTheDocument();
  });

  it("saves who cleans", async () => {
    listResult = list([task({ id: "t1" })]);
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Αλλαγή" }));
    await userEvent.type(screen.getByRole("textbox", { name: /Ποιος καθαρίζει/ }), "Ελένη");
    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
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
    expect(screen.getAllByRole("button", { name: "Προηγούμενες" })[0]).toBeDisabled();
    await userEvent.click(toggle);
    expect(await screen.findByRole("button", { name: "Απόκρυψη ακυρωμένων" })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Επόμενες μέρες" })[0]!);
    await vi.waitFor(() => expect(listInputs).toContainEqual({ page: 1, showCancelled: true }));
  });

  it("makes a cleaner link for a day and offers copy and WhatsApp", async () => {
    listResult = list([task({ id: "t1" })]);
    show();
    const section = (await screen.findByText("Maria Papadopoulou · στις 11:00")).closest("section")!;
    await userEvent.click(within(section).getByRole("button", { name: "Σύνδεσμος για καθαρίστρια" }));
    const field = await within(section).findByRole("textbox", { name: "Σύνδεσμος για την καθαρίστρια" });
    expect((field as HTMLInputElement).value).toMatch(/\/c\/TOKEN$/);
    expect(calls).toContainEqual({ name: "createLink", input: { day: "2030-06-10" } });
    expect(within(section).getByRole("button", { name: "Αντιγραφή συνδέσμου" })).toBeInTheDocument();
    const whatsapp = within(section).getByRole("link", { name: "Άνοιγμα στο WhatsApp" });
    expect(whatsapp.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\?text=.*%2Fc%2FTOKEN$/);
  });
});

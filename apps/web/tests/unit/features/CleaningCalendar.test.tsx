import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import type { CleaningCalendar as CalendarData, TurnoverTask } from "@/api/types";
import { RoleProvider, type Role } from "@/features/shell/role";
import {
  canMoveTo,
  CleaningCalendar,
  firstServiceDay,
  isLocked,
  kindsFor,
  mondayOf,
} from "@/features/turnovers/CleaningCalendar";
import { Toaster } from "@/ui/Toast";
import { latinWords, render, screen, within } from "../intl";

/** The words on screen, one text node at a time, so tag letters do not run into the next name. */
function screenText(root: HTMLElement): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");
  return parts.join(" ");
}

const iso = (s: string) => s as IsoDate;

let result: CalendarData;
const inputs: unknown[] = [];
const calls: Array<{ name: string; input: unknown }> = [];

vi.mock("@/api/client", () => {
  const mutation = (name: string) => ({
    mutationOptions: () => ({
      mutationFn: async (input: unknown) => {
        calls.push({ name, input });
        return { ok: true, version: "2030-06-11T09:00:00.000Z" };
      },
    }),
  });
  return {
    useTRPC: () => ({
      cleaning: {
        pathKey: () => ["cleaning"],
        calendar: {
          queryOptions: (input: unknown) => {
            inputs.push(input);
            return { queryKey: ["cleaning.calendar", input], queryFn: async () => result };
          },
        },
        add: mutation("add"),
        move: mutation("move"),
        remove: mutation("remove"),
        restore: mutation("restore"),
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
    day: iso("2030-06-12"),
    status: "todo",
    taskType: "turnover",
    room: { id: "onar", name: "Onar", label: "Onar", color: "#0F766E" },
    leaving: { guestName: "Maria Papadopoulou", time: "11:00" },
    next: null,
    guest: null,
    start: "11:00",
    end: "13:00",
    assigneeName: null,
    notes: null,
    version: "2030-06-09T10:00:00.000Z",
    conflictsWith: [],
    kind: "A",
    movable: { from: iso("2030-06-12"), to: iso("2030-06-15") },
    ...over,
  };
}

const room = (id: string, name: string, color: string) => ({
  id,
  name,
  color,
  capacity: 3,
  preferredForLargeParty: false,
  isActive: true,
});

function calendar(tasks: TurnoverTask[]): CalendarData {
  return {
    today: iso("2030-06-11"),
    from: iso("2030-06-10"),
    to: iso("2030-07-01"),
    rooms: [room("onar", "Onar", "#0F766E"), room("cosmos", "Cosmos", "#4338CA")],
    stays: [
      {
        id: "b1",
        roomId: "onar",
        guestName: "Maria Papadopoulou",
        checkin: iso("2030-06-08"),
        checkout: iso("2030-06-12"),
        party: null,
      },
      {
        id: "b2",
        roomId: "onar",
        guestName: "Nikos Ioannou",
        checkin: iso("2030-06-15"),
        checkout: iso("2030-06-18"),
        party: null,
      },
      {
        id: "b3",
        roomId: "cosmos",
        guestName: "Eleni Georgiou",
        checkin: iso("2030-06-10"),
        checkout: iso("2030-06-14"),
        party: null,
      },
      {
        id: "b4",
        roomId: "cosmos",
        guestName: "Petros Nikolaou",
        checkin: iso("2030-06-14"),
        checkout: iso("2030-06-20"),
        party: null,
      },
    ],
    tasks,
    cleaners: ["Eleni"],
  };
}

function show(role: Role = "operator") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RoleProvider role={role}>{children}</RoleProvider>
    </QueryClientProvider>
  );
  return render(
    <Wrap>
      <CleaningCalendar viewSwitch={null} onPrint={() => undefined} />
      <Toaster />
    </Wrap>,
  );
}

const NAMES = ["Onar", "Cosmos", "Maria Papadopoulou", "Nikos Ioannou", "Eleni Georgiou", "Petros Nikolaou", "S"];
const changeover = { checkin: iso("2030-06-14"), time: "15:00", party: null, sameDay: true };

beforeEach(() => {
  // The toast's swipe handling asks for this, which jsdom does not have.
  Element.prototype.setPointerCapture = () => {};
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-06-11T09:00:00"));
  calls.length = 0;
  inputs.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("CleaningCalendar", () => {
  it("starts on this week's Monday and shows the stays as bars with A-A, A and S under them", async () => {
    result = calendar([
      task({ id: "t1" }),
      task({
        id: "t2",
        day: iso("2030-06-14"),
        room: { id: "cosmos", name: "Cosmos", label: "Cosmos", color: "#4338CA" },
        next: changeover,
        kind: "AA",
        movable: null,
      }),
      task({
        id: "t3",
        day: iso("2030-06-16"),
        taskType: "service",
        room: { id: "cosmos", name: "Cosmos", label: "Cosmos", color: "#4338CA" },
        kind: "S",
        movable: { from: iso("2030-06-15"), to: iso("2030-06-19") },
      }),
    ]);
    const { container } = show();
    expect(await screen.findAllByTestId("cleaning-stay")).toHaveLength(4);
    expect(inputs[0]).toEqual({ from: "2030-06-10" });
    const tags = screen.getAllByTestId("cleaning-tag");
    expect(tags.map((tag) => [tag.getAttribute("data-day"), tag.textContent])).toEqual([
      ["2030-06-12", "A"],
      ["2030-06-14", "A-A"],
      ["2030-06-16", "S"],
    ]);
    expect(tags[1]).toHaveAccessibleName(/Αναχώρηση και άφιξη/);
    // The × removes A and S; an A-A stays.
    expect(screen.getAllByTestId("cleaning-remove")).toHaveLength(2);
    expect(latinWords(screenText(container), NAMES)).toEqual([]);
  });

  it("adds a cleaning on the day clicked, picking its kind", async () => {
    result = calendar([]);
    show();
    await screen.findAllByTestId("cleaning-stay");
    await userEvent.click(screen.getByRole("button", { name: "Καθάρισμα στο Onar, Πεμ 13 Ιουν" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Το διαμέρισμα είναι άδειο αυτή τη μέρα.")).toBeInTheDocument();
    expect(within(panel).queryByText("Τι ώρα")).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Μόνο σε μέρα που μένουν/ })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: /Αναχώρηση$/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(within(panel).getByPlaceholderText("π.χ. Τζάμια, αλλαγή σεντονιών"), "Τζάμια");
    await userEvent.click(within(panel).getByRole("button", { name: "Προσθήκη καθαρίσματος" }));
    expect(calls).toContainEqual({
      name: "add",
      input: { roomId: "onar", day: "2030-06-13", kind: "A", notes: "Τζάμια" },
    });
  });

  it("adds a service with the + on a stay", async () => {
    result = calendar([]);
    show();
    await screen.findAllByTestId("cleaning-stay");
    await userEvent.click(screen.getByRole("button", { name: "Σέρβις στην κράτηση Nikos Ioannou" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("button", { name: /Σέρβις/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(panel).getByRole("button", { name: "Προσθήκη καθαρίσματος" }));
    expect(calls).toContainEqual({
      name: "add",
      input: { roomId: "onar", day: "2030-06-16", kind: "S", notes: null },
    });
  });

  it("removes a cleaning with the × and puts it back with Undo", async () => {
    result = calendar([task({ id: "t9" })]);
    show();
    await userEvent.click(await screen.findByTestId("cleaning-remove"));
    expect(calls).toContainEqual({ name: "remove", input: { id: "t9", expectedVersion: "2030-06-09T10:00:00.000Z" } });
    await userEvent.click(await screen.findByRole("button", { name: "Αναίρεση" }));
    expect(calls).toContainEqual({ name: "restore", input: { id: "t9", expectedVersion: "2030-06-11T09:00:00.000Z" } });
  });

  it("moves an A to another day from its panel, up to the next arrival", async () => {
    result = calendar([task({ id: "t1" })]);
    show();
    await userEvent.click(await screen.findByTestId("cleaning-tag"));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText(/Μπορεί να πάει έως/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Επόμενη μέρα" }));
    expect(calls).toContainEqual({
      name: "move",
      input: { id: "t1", expectedVersion: "2030-06-09T10:00:00.000Z", day: "2030-06-13" },
    });
  });

  it("keeps an A-A on its day with no ×", async () => {
    result = calendar([
      task({ id: "t1", next: { ...changeover, checkin: iso("2030-06-12") }, kind: "AA", movable: null }),
    ]);
    show();
    await userEvent.click(await screen.findByTestId("cleaning-tag"));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText(/Μένει σε αυτή τη μέρα/)).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Επόμενη μέρα" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("cleaning-remove")).not.toBeInTheDocument();
  });

  it("lets a family viewer look without adding, moving or removing", async () => {
    result = calendar([task({ id: "t1" })]);
    show("viewer");
    await screen.findAllByTestId("cleaning-stay");
    expect(screen.queryAllByTestId("cleaning-cell")).toEqual([]);
    expect(screen.queryAllByTestId("cleaning-add-service")).toEqual([]);
    expect(screen.queryByTestId("cleaning-remove")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Σύνδεσμος|Στείλτε/ })).not.toBeInTheDocument();
  });

  it("knows the week's Monday, which cleanings are fixed and where they may go", () => {
    expect(mondayOf(iso("2030-06-16"))).toBe("2030-06-10");
    expect(mondayOf(iso("2030-06-10"))).toBe("2030-06-10");
    expect(isLocked(task({ id: "a" }))).toBe(false);
    expect(isLocked(task({ id: "b", kind: "AA", movable: null }))).toBe(true);
    const a = task({ id: "c" });
    expect(
      ["2030-06-11", "2030-06-12", "2030-06-15", "2030-06-16"].map((d) => canMoveTo(a, iso(d), iso("2030-06-11"))),
    ).toEqual([false, true, true, false]);
    const data = calendar([task({ id: "t1" })]);
    // Onar: Maria leaves the 12th, Nikos arrives the 15th. Cosmos: Eleni leaves the 14th, Petros arrives that day.
    expect(kindsFor(data, "onar", iso("2030-06-13")).A).toEqual({ ok: false, existing: data.tasks[0] });
    expect(kindsFor(data, "onar", iso("2030-06-16")).S).toEqual({ ok: true });
    expect(kindsFor(data, "onar", iso("2030-06-16")).A).toEqual({ ok: false });
    expect(kindsFor(data, "cosmos", iso("2030-06-14"))).toEqual({
      AA: { ok: true },
      A: { ok: true },
      S: { ok: false },
    });
    expect(firstServiceDay(data.stays[1]!, iso("2030-06-11"))).toBe("2030-06-16");
    expect(firstServiceDay(data.stays[0]!, iso("2030-06-11"))).toBe("2030-06-11");
    expect(firstServiceDay(data.stays[0]!, iso("2030-06-12"))).toBeNull();
  });
});

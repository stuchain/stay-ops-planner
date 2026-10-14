import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import type { CleaningCalendar as CalendarData, TurnoverTask } from "@/api/types";
import { RoleProvider, type Role } from "@/features/shell/role";
import { CleaningCalendar, isLocked, mondayOf } from "@/features/turnovers/CleaningCalendar";
import { latinWords, render, screen, within } from "../intl";

const iso = (s: string) => s as IsoDate;

let result: CalendarData;
const inputs: unknown[] = [];
const calls: Array<{ name: string; input: unknown }> = [];

vi.mock("@/api/client", () => {
  const mutation = (name: string) => ({
    mutationOptions: () => ({
      mutationFn: async (input: unknown) => {
        calls.push({ name, input });
        return { ok: true };
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
    room: { id: "onar", name: "Onar", color: "#0F766E" },
    leaving: { guestName: "Maria Papadopoulou", time: "11:00" },
    next: null,
    start: "11:00",
    end: "13:00",
    assigneeName: null,
    notes: null,
    version: "2030-06-09T10:00:00.000Z",
    conflictsWith: [],
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
    </Wrap>,
  );
}

const NAMES = ["Onar", "Cosmos", "Maria Papadopoulou", "Nikos Ioannou", "Eleni Georgiou", "Petros Nikolaou"];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-06-11T09:00:00"));
  calls.length = 0;
  inputs.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("CleaningCalendar", () => {
  it("starts on this week's Monday and shows the stays as bars with the cleanings under them", async () => {
    result = calendar([
      task({ id: "t1" }),
      task({
        id: "t2",
        day: iso("2030-06-14"),
        room: { id: "cosmos", name: "Cosmos", color: "#4338CA" },
        next: { checkin: iso("2030-06-14"), time: "15:00", party: null, sameDay: true },
      }),
    ]);
    const { container } = show();
    expect(await screen.findAllByTestId("cleaning-stay")).toHaveLength(4);
    expect(inputs[0]).toEqual({ from: "2030-06-10" });
    const tags = screen.getAllByTestId("cleaning-tag");
    expect(tags.map((tag) => tag.getAttribute("data-day"))).toEqual(["2030-06-12", "2030-06-14"]);
    expect(tags[1]).toHaveAccessibleName(/ίδια μέρα έρχεται ο επόμενος επισκέπτης/);
    expect(latinWords(container.textContent ?? "", NAMES)).toEqual([]);
  });

  it("adds a cleaning on the day clicked, with the time and who cleans", async () => {
    result = calendar([]);
    show();
    await screen.findAllByTestId("cleaning-stay");
    await userEvent.click(screen.getByRole("button", { name: "Καθάρισμα στο Onar, Πεμ 13 Ιουν" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Το διαμέρισμα είναι άδειο αυτή τη μέρα.")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: /10:00/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Eleni" }));
    await userEvent.type(within(panel).getByPlaceholderText("π.χ. Τζάμια, αλλαγή σεντονιών"), "Τζάμια");
    await userEvent.click(within(panel).getByRole("button", { name: "Προσθήκη καθαρίσματος" }));
    expect(calls).toContainEqual({
      name: "add",
      input: { roomId: "onar", day: "2030-06-13", start: "10:00", assigneeName: "Eleni", notes: "Τζάμια" },
    });
  });

  it("moves a cleaning to another day from its panel", async () => {
    result = calendar([task({ id: "t1" })]);
    show();
    await userEvent.click(await screen.findByTestId("cleaning-tag"));
    const panel = await screen.findByRole("dialog");
    await userEvent.click(within(panel).getByRole("button", { name: "Επόμενη μέρα" }));
    expect(calls).toContainEqual({
      name: "move",
      input: { id: "t1", expectedVersion: "2030-06-09T10:00:00.000Z", day: "2030-06-13" },
    });
  });

  it("keeps a same-day changeover cleaning on its day and offers no removal", async () => {
    result = calendar([
      task({ id: "t1", next: { checkin: iso("2030-06-12"), time: "15:00", party: null, sameDay: true } }),
    ]);
    show();
    await userEvent.click(await screen.findByTestId("cleaning-tag"));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText(/Μένει σε αυτή τη μέρα/)).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Επόμενη μέρα" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Αφαίρεση καθαρίσματος" })).not.toBeInTheDocument();
  });

  it("removes a cleaning added by hand after asking", async () => {
    result = calendar([task({ id: "t9", taskType: "service", notes: "Τζάμια" })]);
    show();
    await userEvent.click(await screen.findByTestId("cleaning-tag"));
    const panel = await screen.findByRole("dialog");
    await userEvent.click(within(panel).getByRole("button", { name: "Αφαίρεση καθαρίσματος" }));
    await userEvent.click(within(panel).getByRole("button", { name: /Ναι/ }));
    expect(calls).toContainEqual({ name: "remove", input: { id: "t9", expectedVersion: "2030-06-09T10:00:00.000Z" } });
  });

  it("lets a family viewer look without adding or moving", async () => {
    result = calendar([task({ id: "t1" })]);
    show("viewer");
    await screen.findAllByTestId("cleaning-stay");
    expect(screen.queryAllByTestId("cleaning-cell")).toEqual([]);
    expect(screen.queryByRole("button", { name: /Σύνδεσμος|Στείλτε/ })).not.toBeInTheDocument();
  });

  it("knows the week's Monday and which cleanings are fixed", () => {
    expect(mondayOf(iso("2030-06-16"))).toBe("2030-06-10");
    expect(mondayOf(iso("2030-06-10"))).toBe("2030-06-10");
    expect(isLocked(task({ id: "a" }))).toBe(false);
    expect(
      isLocked(task({ id: "b", next: { checkin: iso("2030-06-12"), time: "15:00", party: null, sameDay: true } })),
    ).toBe(true);
    expect(
      isLocked(
        task({
          id: "c",
          taskType: "service",
          next: { checkin: iso("2030-06-12"), time: "15:00", party: null, sameDay: true },
        }),
      ),
    ).toBe(false);
  });
});

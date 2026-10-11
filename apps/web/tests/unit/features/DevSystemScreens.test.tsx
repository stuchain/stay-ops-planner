import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryScreen } from "@/features/dev/HistoryScreen";
import { SystemScreen } from "@/features/dev/SystemScreen";
import { UsersScreen } from "@/features/dev/UsersScreen";
import { auditSentence, actionKey, type AuditRow } from "@/features/dev/auditText";
import { latinWords, render, screen, waitFor, within } from "../intl";
import el from "../../../messages/el.json";

const calls: Record<string, unknown[]> = {};
function record(name: string) {
  return async (input: unknown) => {
    (calls[name] ??= []).push(input);
    return results[name]?.(input);
  };
}
let results: Record<string, (input: unknown) => unknown> = {};

function query(name: string) {
  return {
    queryOptions: (input?: unknown) => ({ queryKey: [name, input], queryFn: record(name) }),
    queryKey: () => [name],
  };
}
function mutation(name: string) {
  return { mutationOptions: () => ({ mutationFn: record(name) }) };
}

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    dev: {
      history: {
        options: query("history.options"),
        list: query("history.list"),
        exportCsv: mutation("history.exportCsv"),
      },
      users: {
        list: query("users.list"),
        setPassword: mutation("users.setPassword"),
        unlock: mutation("users.unlock"),
        signOutEverywhere: mutation("users.signOutEverywhere"),
        updateFlags: mutation("users.updateFlags"),
      },
      system: {
        info: query("system.info"),
        reminder: query("system.reminder"),
        setReminder: mutation("system.setReminder"),
        testReminder: mutation("system.testReminder"),
      },
    },
  }),
}));

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const row = (over: Partial<AuditRow> & Pick<AuditRow, "id">): AuditRow => ({
  at: "2030-06-10T09:30:00.000Z",
  userEmail: "stelios@example.com",
  action: "booking.move",
  entityType: "booking",
  entityId: "bk1",
  event: { kind: "moved", from: "Onar", to: "Cosmos" },
  before: { roomId: "r1" },
  after: { roomId: "r2" },
  meta: null,
  ...over,
});

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  results = {};
});

describe("audit sentences", () => {
  const t = {
    booking: (key: string) => `booking:${key}`,
    action: Object.assign((key: string) => `action:${key}`, { has: (key: string) => key === "auth_login_failed" }),
    unknown: () => "generic",
  };
  it("uses the booking panel sentence for booking changes, then the action's own sentence, then a generic one", () => {
    expect(auditSentence(row({ id: "1" }), t, "el")).toBe("booking:moved");
    expect(auditSentence(row({ id: "2", event: { kind: "other" }, action: "auth.login.failed" }), t, "el")).toBe(
      "action:auth_login_failed",
    );
    expect(auditSentence(row({ id: "3", event: { kind: "other" }, action: "whatever.new" }), t, "el")).toBe("generic");
  });
  it("turns dots into underscores for message keys", () => {
    expect(actionKey("excel_ledger_entry.update_overrides")).toBe("excel_ledger_entry_update_overrides");
  });
  it("has a sentence in the messages for every action the app writes", () => {
    const actions = el.dev.history.actions as Record<string, string>;
    for (const action of [
      "auth.login.succeeded",
      "assignment.assign",
      "room.update",
      "user.password_set",
      "sync.hosthub.full_resync",
    ]) {
      expect(actions[actionKey(action)], action).toBeTruthy();
    }
  });
});

describe("HistoryScreen", () => {
  function setup(items: AuditRow[], total = items.length) {
    results["history.options"] = () => ({
      entityTypes: ["booking", "auth"],
      actions: ["booking.move"],
      users: [{ id: "u1", email: "stelios@example.com" }],
    });
    results["history.list"] = () => ({ items, total, page: 1, pageSize: 50, pages: 1 });
    return render(
      <Wrap>
        <HistoryScreen />
      </Wrap>,
    );
  }

  it("shows readable sentences in Greek, not codes, and the raw JSON on expand", async () => {
    const user = userEvent.setup();
    setup([
      row({ id: "1" }),
      row({
        id: "2",
        userEmail: null,
        event: { kind: "other" },
        action: "auth.login.failed",
        entityType: "auth",
        entityId: "hash",
      }),
    ]);
    expect(await screen.findByText(/Μετακινήθηκε από Onar σε Cosmos/)).toBeInTheDocument();
    expect(screen.getByText("Αποτυχημένη προσπάθεια σύνδεσης (λάθος κωδικός)")).toBeInTheDocument();
    expect(screen.getByText("Το σύστημα")).toBeInTheDocument();
    expect(screen.getByText("2 αλλαγές", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/roomId/)).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Λεπτομέρειες" })[0]!);
    expect(screen.getByText(/"roomId": "r1"/)).toBeInTheDocument();
    expect(screen.getAllByText("booking.move").length).toBeGreaterThan(1);
  });

  it("sends the chosen filters, starting from page one", async () => {
    const user = userEvent.setup();
    setup([row({ id: "1" })]);
    await screen.findByText(/Μετακινήθηκε/);
    await user.type(screen.getByLabelText("Αριθμός κράτησης"), "bk1");
    await user.selectOptions(screen.getByLabelText("Τι αφορά"), "auth");
    await user.click(screen.getByRole("button", { name: "Εμφάνιση" }));
    await waitFor(() => {
      const last = calls["history.list"]!.length;
      expect(last).toBeGreaterThan(0);
    });
    const keys = JSON.stringify(calls["history.list"]);
    expect(keys).toContain("bk1");
  });

  it("downloads the CSV for the current filters", async () => {
    const user = userEvent.setup();
    const created: Blob[] = [];
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: (b: Blob) => (created.push(b), "blob:x"), revokeObjectURL: () => {} }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    results["history.exportCsv"] = () => ({ csv: "﻿time\r\n", rows: 1, truncated: false });
    setup([row({ id: "1" })]);
    await user.click(await screen.findByRole("button", { name: "Λήψη CSV" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]!.type).toContain("text/csv");
  });

  it("says so when nothing matches", async () => {
    setup([], 0);
    expect(await screen.findByText("Καμία αλλαγή")).toBeInTheDocument();
  });

  it("is Greek apart from the identifiers", async () => {
    const { container } = setup([row({ id: "1" })]);
    await screen.findByText(/Μετακινήθηκε/);
    expect(
      latinWords(container.textContent ?? "", [
        "stelios",
        "example.com",
        "bk1",
        "Onar",
        "Cosmos",
        "CSV",
        "booking.move",
        "bk",
      ]),
    ).toEqual([]);
  });
});

describe("UsersScreen", () => {
  const user = (over: Partial<Record<string, unknown>>) => ({
    id: "u1",
    email: "papa@example.com",
    role: "operator",
    isActive: true,
    locale: "el",
    lastLoginAt: "2030-06-10T09:30:00.000Z",
    lockedForSeconds: null,
    flags: { newUi: false },
    ...over,
  });

  function setup(users: unknown[]) {
    results["users.list"] = () => ({ users, flagKeys: ["newUi"] });
    return render(
      <Wrap>
        <UsersScreen />
      </Wrap>,
    );
  }

  it("lists the users with their sign-in state", async () => {
    setup([user({}), user({ id: "u2", email: "locked@example.com", lockedForSeconds: 200, lastLoginAt: null })]);
    expect(await screen.findByText("papa@example.com")).toBeInTheDocument();
    expect(screen.getByText("Μπλοκαρισμένη")).toBeInTheDocument();
    expect(screen.getByText("Καμία ακόμα")).toBeInTheDocument();
    expect(screen.getAllByText("Χειριστής").length).toBe(2);
  });

  it("sets a new password, unlocks and signs out through the panel", async () => {
    const u = userEvent.setup();
    results["users.setPassword"] = () => ({ ok: true });
    results["users.unlock"] = () => ({ cleared: 5 });
    results["users.signOutEverywhere"] = () => ({ ok: true });
    setup([user({ lockedForSeconds: 200 })]);
    await u.click(await screen.findByRole("button", { name: "Διαχείριση" }));
    const panel = await screen.findByRole("dialog");

    await u.type(within(panel).getByLabelText(/^Νέος κωδικός/), "new-secret-1");
    await u.click(within(panel).getByRole("button", { name: "Αποθήκευση κωδικού" }));
    await waitFor(() => expect(calls["users.setPassword"]).toEqual([{ userId: "u1", newPassword: "new-secret-1" }]));

    expect(within(panel).getByText(/μπλοκαρισμένη για άλλα 4 λεπτά/)).toBeInTheDocument();
    await u.click(within(panel).getByRole("button", { name: "Ξεκλείδωμα" }));
    await waitFor(() => expect(calls["users.unlock"]).toEqual([{ userId: "u1" }]));

    // Signing out needs a second, explicit click.
    await u.click(within(panel).getByRole("button", { name: "Αποσύνδεση από παντού" }));
    expect(calls["users.signOutEverywhere"]).toBeUndefined();
    await u.click(within(panel).getByRole("button", { name: "Ναι, αποσύνδεση" }));
    await waitFor(() => expect(calls["users.signOutEverywhere"]).toEqual([{ userId: "u1" }]));
  });

  it("cannot unlock someone who is not locked", async () => {
    const u = userEvent.setup();
    setup([user({})]);
    await u.click(await screen.findByRole("button", { name: "Διαχείριση" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("button", { name: "Ξεκλείδωμα" })).toBeDisabled();
  });
});

describe("SystemScreen", () => {
  it("shows the version, database, Sentry link and saves a flag change", async () => {
    const u = userEvent.setup();
    results["system.info"] = () => ({
      version: "0.1.0",
      commit: "abcdef1234567890",
      database: { ok: true, pingMs: 12, migrations: 31 },
      sentryUrl: "https://sentry.io/organizations/x/projects/y/",
    });
    results["users.list"] = () => ({
      users: [
        {
          id: "u1",
          email: "papa@example.com",
          role: "operator",
          isActive: true,
          locale: "el",
          lastLoginAt: null,
          lockedForSeconds: null,
          flags: { newUi: false },
        },
      ],
      flagKeys: ["newUi"],
    });
    results["users.updateFlags"] = () => ({ newUi: true });
    results["system.reminder"] = () => ({ enabled: true, configured: true });
    results["system.setReminder"] = () => ({ enabled: false, lastSentOn: null });
    results["system.testReminder"] = () => ({ status: "sent" });
    render(
      <Wrap>
        <SystemScreen />
      </Wrap>,
    );
    expect(await screen.findByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("abcdef1")).toBeInTheDocument();
    expect(screen.getByText("Λειτουργεί (12 ms)")).toBeInTheDocument();
    expect(screen.getByText("31")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Άνοιγμα/ })).toHaveAttribute(
      "href",
      "https://sentry.io/organizations/x/projects/y/",
    );

    await u.click(await screen.findByRole("checkbox", { name: "Νέα εμφάνιση της εφαρμογής" }));
    await waitFor(() => expect(calls["users.updateFlags"]).toEqual([{ userId: "u1", patch: { newUi: true } }]));

    await u.click(screen.getByRole("checkbox", { name: "Αποστολή κάθε πρωί" }));
    await waitFor(() => expect(calls["system.setReminder"]).toEqual([{ enabled: false }]));
    await u.click(screen.getByRole("button", { name: "Στείλε το τώρα για δοκιμή" }));
    await waitFor(() => expect(calls["system.testReminder"]).toHaveLength(1));
  });

  it("says when the database does not answer and there is no Sentry link", async () => {
    results["system.info"] = () => ({ version: "0.1.0", commit: null, database: { ok: false }, sentryUrl: null });
    results["users.list"] = () => ({ users: [], flagKeys: ["newUi"] });
    results["system.reminder"] = () => ({ enabled: true, configured: false });
    render(
      <Wrap>
        <SystemScreen />
      </Wrap>,
    );
    expect(await screen.findByText("Δεν απαντά")).toBeInTheDocument();
    expect(screen.getByText("Τοπική εκτέλεση")).toBeInTheDocument();
    expect(screen.getByText("Δεν έχει οριστεί σύνδεσμος")).toBeInTheDocument();
    expect(await screen.findByText(/Δεν έχει ρυθμιστεί πού να σταλεί/)).toBeInTheDocument();
  });
});

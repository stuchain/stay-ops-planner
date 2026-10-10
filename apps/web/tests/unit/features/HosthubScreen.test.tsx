// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, latinWords, render, screen, waitFor } from "../intl";
import { HosthubScreen } from "@/features/dev/HosthubScreen";

const calls = vi.hoisted(() => ({ save: vi.fn(), sync: vi.fn(), reset: vi.fn(), runsPages: vi.fn() }));

const { overview, runs, errors } = vi.hoisted(() => {
  const overview = {
    token: { configured: true, updatedAt: "2030-06-01T10:00:00Z", name: "Κύριο" },
    cursor: "1893456000",
    lastSuccessAt: "2030-06-10T08:00:00Z",
    lastError: null,
    running: false,
    webhook: {
      path: "/api/sync/hosthub/webhook",
      secretConfigured: true,
      lastReceivedAt: "2030-06-10T07:30:00Z",
      receivedLast24h: 3,
    },
  };

  const runs = {
    items: [
      {
        id: "r2",
        startedAt: "2030-06-10T08:00:00Z",
        completedAt: "2030-06-10T08:00:03Z",
        durationMs: 3000,
        status: "completed",
        fetched: 12,
        created: 2,
        updated: 1,
        unchanged: 9,
        errors: 0,
      },
      {
        id: "r1",
        startedAt: "2030-06-09T08:00:00Z",
        completedAt: null,
        durationMs: null,
        status: "failed",
        fetched: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        errors: 0,
      },
    ],
    nextCursor: null,
  };

  const errors = {
    items: [
      {
        id: "e1",
        code: "APPLY_ERROR",
        message: "bad dates",
        createdAt: "2030-06-10T08:00:00Z",
        syncRunId: "r2",
        payload: { id: "evt-1", checkin: "oops" },
      },
    ],
    nextCursor: null,
  };
  return { overview, runs, errors };
});

vi.mock("@/api/client", () => {
  const key = (name: string) => () => [name];
  const list = (name: string, data: unknown) => ({
    queryKey: key(name),
    pathKey: key(name),
    infiniteQueryOptions: () => ({
      queryKey: [name, "inf"],
      queryFn: async () => data,
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
    }),
  });
  const trpc = {
    sync: { status: { queryKey: key("sync.status") } },
    dev: {
      hosthub: {
        overview: {
          queryKey: key("overview"),
          queryOptions: () => ({ queryKey: ["overview"], queryFn: async () => overview }),
        },
        runs: list("runs", runs),
        errors: list("errors", errors),
        saveToken: { mutationOptions: () => ({ mutationFn: async (input: unknown) => calls.save(input) }) },
        sync: { mutationOptions: () => ({ mutationFn: async (input: unknown) => calls.sync(input) }) },
        resetCursor: { mutationOptions: () => ({ mutationFn: async () => calls.reset() }) },
      },
    },
  };
  return { useTRPC: () => trpc };
});

vi.mock("@/ui/Toast", () => ({ showToast: vi.fn() }));

afterEach(cleanup);
beforeEach(() => {
  calls.save.mockReset().mockResolvedValue({});
  calls.sync
    .mockReset()
    .mockResolvedValue({ outcome: "done", changed: 3, created: 2, updated: 1, unchanged: 0, errors: 0 });
  calls.reset.mockReset().mockResolvedValue({ previous: "1" });
});

function show(locale: "el" | "en" = "el") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HosthubScreen />
    </QueryClientProvider>,
    { locale },
  );
}

function rejection(code: string) {
  return Object.assign(new TRPCClientError("x"), { data: { domain: { code, params: {} } } });
}

describe("HosthubScreen", () => {
  it("shows the token, history, import errors and the webhook, in Greek", async () => {
    const { container } = show();
    expect(await screen.findByText(/Υπάρχει αποθηκευμένο κλειδί/)).toBeInTheDocument();
    expect(await screen.findByText("Πέτυχε")).toBeInTheDocument();
    expect(screen.getByText("Απέτυχε")).toBeInTheDocument();
    expect(screen.getByText("3.0 δευτ.")).toBeInTheDocument();
    expect(screen.getByText(/12 από το Hosthub · 2 νέες · 1 άλλαξαν · 0 σφάλματα/)).toBeInTheDocument();
    expect(await screen.findByText("bad dates")).toBeInTheDocument();
    expect(screen.getByText(/Τις τελευταίες 24 ώρες: 3 μηνύματα/)).toBeInTheDocument();
    expect(container.querySelector("code")?.textContent).toContain("/api/sync/hosthub/webhook");
    const spoken = [...container.querySelectorAll("*")]
      .filter((el) => el.tagName !== "CODE")
      .flatMap((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? ""))
      .join(" ");
    expect(latinWords(spoken, ["Webhook", "webhook.", "Hosthub.", "bad dates", "APPLY_ERROR"])).toEqual([]);
  });

  it("expands an import error to show the raw payload", async () => {
    const user = userEvent.setup();
    show();
    const row = await screen.findByRole("button", { name: /bad dates/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/"checkin": "oops"/)).toBeInTheDocument();
  });

  it("shows the refusal sentence and keeps the field when Hosthub rejects the key", async () => {
    const user = userEvent.setup();
    calls.save.mockRejectedValue(rejection("HOSTHUB_TOKEN_REJECTED"));
    show();
    const input = await screen.findByLabelText("Νέο κλειδί");
    await user.type(input, "bad-key");
    await user.click(screen.getByRole("button", { name: "Δοκιμή και αποθήκευση" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Το Hosthub δεν δέχτηκε αυτό το κλειδί");
    expect(input).toHaveValue("bad-key");
    expect(calls.save).toHaveBeenCalledWith({ token: "bad-key", name: null });
  });

  it("asks before a full sync and before resetting the cursor", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: "Πλήρης ενημέρωση" }));
    expect(calls.sync).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Ακύρωση" }));
    expect(dialog).not.toBeInTheDocument();
    expect(calls.sync).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Πλήρης ενημέρωση" }));
    await user.click(screen.getByRole("button", { name: "Ναι, πλήρης ενημέρωση" }));
    await waitFor(() => expect(calls.sync).toHaveBeenCalledWith({ full: true }));

    await user.click(screen.getByRole("button", { name: "Μηδενισμός σημείου εκκίνησης" }));
    expect(calls.reset).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ναι, μηδενισμός" }));
    await waitFor(() => expect(calls.reset).toHaveBeenCalledTimes(1));
  });

  it("runs the incremental sync without asking", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: "Ενημέρωση τώρα" }));
    await waitFor(() => expect(calls.sync).toHaveBeenCalledWith({ full: false }));
  });
});

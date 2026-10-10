import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionLink, TRPCProvider } from "@/api/client";
import { isSessionExpired, readClientError } from "@/api/errors";
import { signedIn, waitForSignIn } from "@/api/sessionGate";
import { SessionDialog } from "@/features/shell/SessionDialog";
import type { AppRouter } from "@/server/api/root";
import { fireEvent, latinWords, render, screen, waitFor } from "../intl";

/** What the sign-in check answers before tRPC runs: plain JSON with a 401. */
function expired() {
  return new TRPCClientError("UNAUTHORIZED", { meta: { response: { status: 401 } } });
}

function setup(opts: { expireFirst: Set<string>; sessionEndsAt?: string | null }) {
  const calls: string[] = [];
  const link: TRPCLink<AppRouter> =
    () =>
    ({ op }) =>
      observable((observer) => {
        calls.push(op.path);
        if (opts.expireFirst.delete(op.path)) {
          observer.error(expired());
          return;
        }
        const data =
          op.path === "me.get"
            ? { email: "father@example.com", role: "operator", sessionEndsAt: opts.sessionEndsAt ?? null }
            : { ok: true };
        observer.next({ result: { data } });
        observer.complete();
      });
  const client = createTRPCClient<AppRouter>({ links: [sessionLink, link] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={client} queryClient={queryClient}>
        <SessionDialog />
      </TRPCProvider>
    </QueryClientProvider>
  );
  return { ui, client, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("session expiry (E2-1)", () => {
  it("reads a bare 401 as an expired session, not a network problem", () => {
    expect(isSessionExpired(expired())).toBe(true);
    expect(readClientError(expired()).code).toBe("UNAUTHORIZED");
  });

  it("fails at once when no sign-in dialog is on the page", async () => {
    await expect(waitForSignIn("original")).rejects.toBe("original");
  });

  it("keeps the save waiting, signs in on the page in Greek, then saves", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { user: { email: "father@example.com" } } }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { ui, client, calls } = setup({ expireFirst: new Set(["me.updatePreferences"]) });
    render(ui);
    const save = client.me.updatePreferences.mutate({ textSize: "large" });
    const dialog = await screen.findByRole("dialog", { name: "Η σύνδεση έληξε" });
    expect(latinWords(dialog.textContent ?? "")).toEqual(["Email"]);
    await waitFor(() => expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("father@example.com"));
    fireEvent.change(screen.getByLabelText("Κωδικός"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Σύνδεση" }));
    await expect(save).resolves.toEqual({ ok: true });
    expect(calls.filter((path) => path === "me.updatePreferences")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says a wrong password in words and keeps waiting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 401 })));
    const { ui, client } = setup({ expireFirst: new Set(["me.updatePreferences"]) });
    render(ui);
    const save = client.me.updatePreferences.mutate({ textSize: "large" });
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Κωδικός"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Σύνδεση" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Το email ή ο κωδικός δεν είναι σωστά.");
    signedIn();
    await expect(save).resolves.toEqual({ ok: true });
  });

  it("cancelling fails the save with the session message", async () => {
    const { ui, client } = setup({ expireFirst: new Set(["me.updatePreferences"]) });
    render(ui);
    const save = client.me.updatePreferences.mutate({ textSize: "large" });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Άκυρο" }));
    await expect(save).rejects.toSatisfy(isSessionExpired);
  });

  it("asks to sign in again 5 minutes before the 12-hour end", async () => {
    const { ui } = setup({ expireFirst: new Set(), sessionEndsAt: new Date(Date.now() + 4 * 60_000).toISOString() });
    render(ui);
    expect(await screen.findByRole("dialog", { name: "Η σύνδεση λήγει σε λίγα λεπτά" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Αργότερα" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

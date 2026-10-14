import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { describe, expect, it, vi } from "vitest";
import { TRPCProvider } from "@/api/client";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import type { AppRouter } from "@/server/api/root";
import { latinWords, render, screen, waitFor } from "../intl";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/app/settings",
}));

type Role = "viewer" | "operator" | "admin";

function setup(role: Role, locale: "el" | "en" = "el") {
  const calls: Array<{ path: string; input: unknown }> = [];
  const answers: Record<string, unknown> = {
    "me.get": { email: "stelios@example.com", role, locale, textSize: "normal", devMode: false, flags: {} },
    "sync.status": { lastSuccessAt: null, running: false, problem: "none" },
    "me.updatePreferences": { locale, textSize: "large" },
    "admin.family.list": { members: [] },
  };
  const link: TRPCLink<AppRouter> =
    () =>
    ({ op }) =>
      observable((observer) => {
        calls.push({ path: op.path, input: op.input });
        observer.next({ result: { data: answers[op.path] ?? { ok: true } } });
        observer.complete();
      });
  const client = createTRPCClient<AppRouter>({ links: [link] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={client} queryClient={queryClient}>
        <SettingsScreen />
      </TRPCProvider>
    </QueryClientProvider>
  );
  return { ui, calls };
}

describe("SettingsScreen", () => {
  it("is fully Greek and shows every card for an admin, Hosthub included", async () => {
    const { ui } = setup("admin");
    const { container } = render(ui);
    await screen.findByText("Λειτουργία προγραμματιστή");
    expect(screen.getByText("Γλώσσα · Ελληνικά")).toBeTruthy();
    expect(screen.getByText("Σύνδεση με το Hosthub")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ενημέρωση τώρα" })).toBeTruthy();
    // "Excel" is the file's name, as on the money screen ("Σαν το Excel").
    expect(latinWords(container.textContent ?? "", ["English", "Excel"])).toEqual([]);
    expect(screen.getByText("Οικογένεια")).toBeTruthy();
    expect(screen.getByText("Διαμερίσματα από το Excel ημερολόγιο")).toBeTruthy();
    expect(screen.queryByText(/stelios@example\.com/)).toBeNull();
  });

  it("puts text size first, then phone calendar, password and language, and folds the last two", async () => {
    const { ui } = setup("operator");
    const { container } = render(ui);
    await screen.findByText("Γλώσσα · Ελληνικά");
    const text = container.textContent ?? "";
    const order = ["Μέγεθος γραμμάτων", "Ημερολόγιο στο κινητό", "Αλλαγή κωδικού", "Γλώσσα · Ελληνικά"].map((s) =>
      text.indexOf(s),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getByTestId("settings-password")).not.toHaveAttribute("open");
    expect(screen.getByTestId("settings-language")).not.toHaveAttribute("open");
  });

  it("hides Hosthub and Dev mode from everyone but admins", async () => {
    const { ui } = setup("operator");
    render(ui);
    await screen.findByText("Γλώσσα · Ελληνικά");
    expect(screen.queryByText("Λειτουργία προγραμματιστή")).toBeNull();
    expect(screen.queryByText("Σύνδεση με το Hosthub")).toBeNull();
    expect(screen.queryByText("Οικογένεια")).toBeNull();
    expect(screen.queryByTestId("paper-calendar-card")).toBeNull();
  });

  it("names the current language in its folded heading", async () => {
    const { ui } = setup("operator", "en");
    render(ui);
    expect(await screen.findByText("Γλώσσα · English")).toBeTruthy();
  });

  it("saves the text size and refreshes the language on choosing", async () => {
    const { ui, calls } = setup("operator");
    render(ui);
    const large = await screen.findByRole("radio", { name: /Μεγάλο/ });
    large.click();
    await waitFor(() =>
      expect(calls.find((c) => c.path === "me.updatePreferences")?.input).toEqual({ textSize: "large" }),
    );
  });
});

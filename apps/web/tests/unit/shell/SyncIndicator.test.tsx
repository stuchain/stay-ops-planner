import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { STALE_AFTER_MS, SyncIndicator } from "@/features/shell/SyncIndicator";
import { render, screen, waitFor } from "../intl";

type Status = { lastSuccessAt: string | null; running: boolean; problem: "none" | "auth" | "other" };
let status: Status;

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    sync: { status: { queryOptions: () => ({ queryKey: ["sync.status"], queryFn: async () => status }) } },
  }),
}));

const NOW = Date.parse("2030-06-10T09:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function show(s: Status) {
  status = s;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <div data-testid="box">
        <SyncIndicator now={NOW} />
      </div>
    </QueryClientProvider>,
  );
  return { view, client };
}

describe("SyncIndicator", () => {
  it("stays silent while the updates work", async () => {
    const { client } = show({ lastSuccessAt: ago(10 * 60_000), running: false, problem: "none" });
    await waitFor(() => expect(client.getQueryData(["sync.status"])).toBeDefined());
    expect(screen.getByTestId("box")).toBeEmptyDOMElement();
  });

  it("speaks up when the last update failed", async () => {
    show({ lastSuccessAt: ago(2 * 60 * 60_000), running: false, problem: "other" });
    expect(await screen.findByText(/Η ενημέρωση από το Hosthub δεν πέτυχε/)).toBeInTheDocument();
  });

  it("speaks up when nothing succeeded for a day", async () => {
    show({ lastSuccessAt: ago(STALE_AFTER_MS + 60 * 60_000), running: false, problem: "none" });
    expect(await screen.findByText(/Τελευταία ενημέρωση από το Hosthub/)).toBeInTheDocument();
  });

  it("leaves a broken key to the banner", async () => {
    const { client } = show({ lastSuccessAt: ago(STALE_AFTER_MS * 3), running: false, problem: "auth" });
    await waitFor(() => expect(client.getQueryData(["sync.status"])).toBeDefined());
    expect(screen.getByTestId("box")).toBeEmptyDOMElement();
  });
});

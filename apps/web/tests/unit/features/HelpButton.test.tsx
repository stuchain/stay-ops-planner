import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetErrors, rememberError } from "@/api/lastError";
import { HelpButton } from "@/features/shell/HelpButton";
import { render, screen, waitFor } from "../intl";

const sendFn = vi.fn();
const toast = vi.fn();

vi.mock("@/api/client", () => ({
  useTRPC: () => ({ help: { send: { mutationOptions: () => ({ mutationFn: (input: unknown) => sendFn(input) }) } } }),
}));
vi.mock("@/ui/Toast", () => ({ showToast: (options: unknown) => toast(options) }));
vi.mock("@sentry/nextjs", () => ({ lastEventId: () => "evt-1" }));

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("HelpButton", () => {
  beforeEach(() => {
    sendFn.mockReset();
    toast.mockReset();
    forgetErrors();
  });

  it("sends the message with the page, the last error and the Sentry id", async () => {
    const u = userEvent.setup();
    rememberError("Η κράτηση άλλαξε στο μεταξύ.", new Date("2030-06-10T09:00:00Z"));
    sendFn.mockResolvedValue({ status: "sent" });
    render(
      <Wrap>
        <HelpButton />
      </Wrap>,
    );
    await u.click(screen.getByRole("button", { name: "Στείλε στον Στέλιο" }));
    expect(screen.getByText("Τελευταίο σφάλμα: Η κράτηση άλλαξε στο μεταξύ.")).toBeInTheDocument();
    await u.type(screen.getByLabelText("Τι συμβαίνει; (προαιρετικό)"), "Βοήθεια");
    await u.click(screen.getByRole("button", { name: "Αποστολή" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "success" })));
    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Βοήθεια",
        page: "/",
        sentryEventId: "evt-1",
        lastError: { text: "Η κράτηση άλλαξε στο μεταξύ.", at: "2030-06-10T09:00:00.000Z" },
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks to phone when the message could not be sent", async () => {
    const u = userEvent.setup();
    sendFn.mockResolvedValue({ status: "unconfigured" });
    render(
      <Wrap>
        <HelpButton />
      </Wrap>,
    );
    await u.click(screen.getByRole("button", { name: "Στείλε στον Στέλιο" }));
    await u.click(screen.getByRole("button", { name: "Αποστολή" }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ message: "Δεν στάλθηκε. Πάρτε τηλέφωνο τον Στέλιο.", tone: "danger" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

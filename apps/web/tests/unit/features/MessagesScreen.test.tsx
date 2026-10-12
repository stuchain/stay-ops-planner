import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageTemplatesData } from "@/api/types";
import { MessagesScreen } from "@/features/dev/MessagesScreen";
import { DEFAULT_TEMPLATES } from "@/i18n/guestMessages/defaults";
import { render, screen, waitFor } from "../intl";

const calls = vi.hoisted(() => ({ save: vi.fn(), reset: vi.fn() }));
vi.mock("@/ui/Toast", () => ({ showToast: vi.fn() }));

let data: MessageTemplatesData;

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    booking: { messageTemplates: { queryKey: () => ["booking-templates"] } },
    dev: {
      apartments: {
        list: {
          queryOptions: () => ({
            queryKey: ["apartments"],
            queryFn: async () => [
              { id: "r1", name: "Onar" },
              { id: "r2", name: "Cosmos" },
            ],
          }),
        },
      },
      messageTemplates: {
        queryKey: () => ["templates"],
        queryOptions: () => ({ queryKey: ["templates"], queryFn: async () => data }),
      },
      saveMessageTemplate: { mutationOptions: () => ({ mutationFn: async (input: unknown) => calls.save(input) }) },
      resetMessageTemplate: { mutationOptions: () => ({ mutationFn: async (input: unknown) => calls.reset(input) }) },
    },
  }),
}));

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MessagesScreen />
    </QueryClientProvider>,
  );
}

const textbox = () => screen.findByRole("textbox", { name: "Κείμενο του μηνύματος" }) as Promise<HTMLTextAreaElement>;

beforeEach(() => {
  data = { overrides: [], defaults: DEFAULT_TEMPLATES };
  calls.save
    .mockReset()
    .mockImplementation(async (input: { kind: never; lang: never; roomId: null; text: string }) => ({
      ...data,
      overrides: [input],
    }));
  calls.reset.mockReset().mockResolvedValue({ overrides: [], defaults: DEFAULT_TEMPLATES });
});

describe("MessagesScreen", () => {
  it("shows the built-in text and a live preview with a sample booking", async () => {
    show();
    const text = await textbox();
    expect(text.value).toBe(DEFAULT_TEMPLATES.welcome.el);
    expect(screen.getByTestId("preview")).toHaveTextContent("Καλησπέρα Μαρία Παπαδοπούλου!");
    expect(screen.getByText(/Εδώ δεν έχει αποθηκευτεί δικό σας κείμενο/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Αποθήκευση" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Επαναφορά προεπιλογής" })).toBeDisabled();
  });

  it("inserts a placeholder where the cursor is, updates the preview and saves for the chosen apartment", async () => {
    const user = userEvent.setup();
    show();
    const text = await textbox();
    await user.clear(text);
    await user.type(text, "Γεια  τώρα");
    text.setSelectionRange(5, 5);
    await user.click(screen.getByRole("button", { name: "Προσθήκη: Αριθμός νυχτών" }));
    expect(text.value).toBe("Γεια {nights} τώρα");
    expect(screen.getByTestId("preview")).toHaveTextContent("Γεια 4 νύχτες τώρα");
    expect(screen.getByText("Έχετε αλλαγές που δεν έχουν αποθηκευτεί ακόμα.")).toBeInTheDocument();

    await screen.findByRole("option", { name: "Onar" });
    await user.selectOptions(screen.getByLabelText("Για ποιο διαμέρισμα"), "r2");
    // Changing the scope drops the unsaved typing and shows the text that applies there.
    expect(text.value).toBe(DEFAULT_TEMPLATES.welcome.el);
    await user.clear(text);
    await user.type(text, "Cosmos only");
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() =>
      expect(calls.save).toHaveBeenCalledWith({ kind: "welcome", lang: "el", roomId: "r2", text: "Cosmos only" }),
    );
  });

  it("switching kind and language shows the matching built-in text, and reset removes an override", async () => {
    const user = userEvent.setup();
    data = {
      defaults: DEFAULT_TEMPLATES,
      overrides: [{ kind: "wifi", lang: "en", roomId: null, text: "My Wi-Fi {guest}" }],
    };
    show();
    await textbox();
    await user.click(screen.getByRole("radio", { name: "Wi-Fi" }));
    await user.click(screen.getByRole("radio", { name: "English" }));
    expect((await textbox()).value).toBe("My Wi-Fi {guest}");
    expect(screen.getByText("Αυτό είναι το κείμενο που αποθηκεύσατε.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Επαναφορά προεπιλογής" }));
    // It asks first, so a stray click never throws away the person's text.
    expect(calls.reset).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ναι" }));
    await waitFor(() => expect(calls.reset).toHaveBeenCalledWith({ kind: "wifi", lang: "en", roomId: null }));
    await waitFor(async () => expect((await textbox()).value).toBe(DEFAULT_TEMPLATES.wifi.en));
  });

  it("says when an apartment uses the text for all apartments", async () => {
    const user = userEvent.setup();
    data = {
      defaults: DEFAULT_TEMPLATES,
      overrides: [{ kind: "welcome", lang: "el", roomId: null, text: "Shared" }],
    };
    show();
    await textbox();
    await screen.findByRole("option", { name: "Onar" });
    await user.selectOptions(screen.getByLabelText("Για ποιο διαμέρισμα"), "r1");
    expect((await textbox()).value).toBe("Shared");
    expect(screen.getByText(/Αυτό το διαμέρισμα δεν έχει δικό του κείμενο/)).toBeInTheDocument();
  });
});

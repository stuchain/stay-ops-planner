import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarBooking, MessageTemplatesData } from "@/api/types";
import { GuestMessage } from "@/features/calendar/GuestMessage";
import { DEFAULT_TEMPLATES } from "@/i18n/guestMessages/defaults";
import { render, screen } from "../intl";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/ui/Toast", () => ({ showToast: toast }));

let data: MessageTemplatesData;

vi.mock("@/api/client", () => ({
  useTRPC: () => ({
    booking: {
      messageTemplates: { queryOptions: () => ({ queryKey: ["templates"], queryFn: async () => data }) },
    },
  }),
}));

const booking = {
  id: "b1",
  guestName: "Maria Smith",
  checkin: "2030-07-12",
  checkout: "2030-07-16",
  nights: 4,
  partySize: 3,
  assignment: { roomId: "r1", pinned: false },
} as CalendarBooking;

function show(phone: string | null, roomName: string | null = "Cosmos") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GuestMessage booking={booking} roomName={roomName} phone={phone} />
    </QueryClientProvider>,
  );
}

const box = () => screen.findByRole("textbox", { name: "Το μήνυμα" }) as Promise<HTMLTextAreaElement>;

beforeEach(() => {
  toast.mockReset();
  data = { overrides: [], defaults: DEFAULT_TEMPLATES };
});

describe("GuestMessage", () => {
  it("shows the Greek welcome for a Greek number, filled in, and switches kind and language", async () => {
    const user = userEvent.setup();
    show("+30 691 234 5678");
    const text = await box();
    expect(text).toHaveAttribute("readonly");
    expect(text.value).toContain("Καλησπέρα Maria Smith!");
    expect(text.value).toContain("Παρ 12 Ιουλ 2030");
    expect(text.value).toContain("Διαμέρισμα: Cosmos");

    await user.click(screen.getByRole("radio", { name: "Wi-Fi" }));
    expect(text.value).toContain("Το Wi-Fi του διαμερίσματος");
    await user.click(screen.getByRole("radio", { name: "English" }));
    expect(text.value).toContain("The Wi-Fi in the apartment");
  });

  it("starts in English for a foreign number or no phone, and says WhatsApp will ask for a contact", async () => {
    show(null);
    expect((await box()).value).toContain("Hello Maria Smith!");
    expect(screen.getByRole("radio", { name: "English" })).toBeChecked();
    expect(screen.getByRole("link", { name: "Άνοιγμα στο WhatsApp" }).getAttribute("href")).toMatch(
      /^https:\/\/wa\.me\/\?text=/,
    );
    expect(screen.getByText(/δεν έχει τηλέφωνο/)).toBeInTheDocument();
  });

  it("uses the apartment's own saved text before the shared one", async () => {
    data = {
      defaults: DEFAULT_TEMPLATES,
      overrides: [
        { kind: "welcome", lang: "el", roomId: null, text: "Shared {guest}" },
        { kind: "welcome", lang: "el", roomId: "r1", text: "Own {guest} in {apartment}" },
      ],
    };
    show("6912345678");
    expect((await box()).value).toBe("Own Maria Smith in Cosmos");
  });

  it("opens WhatsApp in a new tab with the phone's digits and the encoded text", async () => {
    show("+30 691 234 5678");
    const text = await box();
    const link = screen.getByRole("link", { name: "Άνοιγμα στο WhatsApp" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("href", `https://wa.me/306912345678?text=${encodeURIComponent(text.value)}`);
  });

  it("copies the text and says Αντιγράφηκε, or says it could not", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    show("+30 691 234 5678");
    const text = await box();
    await user.click(screen.getByRole("button", { name: "Αντιγραφή" }));
    expect(writeText).toHaveBeenCalledWith(text.value);
    expect(toast).toHaveBeenCalledWith({ message: "Αντιγράφηκε", tone: "success" });

    writeText.mockRejectedValue(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Αντιγραφή" }));
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "danger" }));
  });
});

// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import { cleanup, render, screen } from "../intl";
import type { CalendarBooking } from "@/api/types";
import { barName } from "@/features/calendar/barName";
import { MoreMenu } from "@/features/calendar/MoreMenu";
import { Tray } from "@/features/calendar/Tray";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("barName", () => {
  it("keeps the whole name when it fits and shows the surname on a short bar", () => {
    expect(barName("Anna Nowak", 400)).toBe("Anna Nowak");
    expect(barName("Anna Nowak", 120)).toBe("Nowak");
    expect(barName("Pierre Jean Dubois", 120)).toBe("Dubois");
    expect(barName("Nowak", 60)).toBe("Nowak");
    expect(barName("Anna Nowak", undefined)).toBe("Anna Nowak");
  });
});

describe("MoreMenu", () => {
  it("hides Search and Print behind Περισσότερα and closes with Escape", async () => {
    const user = userEvent.setup();
    const onPrint = vi.fn();
    render(<MoreMenu onPrint={onPrint} />);
    const more = screen.getByRole("button", { name: "Περισσότερα" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Αναζήτηση" })).toBeNull();

    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Αναζήτηση" })).toHaveAttribute("href", "/app/search");
    await user.keyboard("{Escape}");
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveFocus();

    await user.click(more);
    await user.click(screen.getByRole("button", { name: "Εκτύπωση" }));
    expect(onPrint).toHaveBeenCalledOnce();
    expect(more).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Tray", () => {
  const waiting = {
    id: "b1",
    guestName: "Olivia Brown",
    checkin: "2030-10-19" as IsoDate,
    checkout: "2030-10-24" as IsoDate,
    nights: 5,
    partySize: 3,
    channel: "airbnb",
    status: "confirmed",
    assignment: null,
  } as CalendarBooking;

  it("offers Βάλτε τις αυτόματα only when it is given something to place", async () => {
    const user = userEvent.setup();
    const onArrange = vi.fn();
    const { rerender } = render(
      <DndContext>
        <Tray bookings={[waiting]} selectedId={null} acceptsDrop={false} onOpen={() => {}} onArrange={onArrange} />
      </DndContext>,
    );
    await user.click(screen.getByRole("button", { name: "Βάλτε τις αυτόματα" }));
    expect(onArrange).toHaveBeenCalledOnce();

    rerender(
      <DndContext>
        <Tray bookings={[waiting]} selectedId={null} acceptsDrop={false} onOpen={() => {}} />
      </DndContext>,
    );
    expect(screen.queryByRole("button", { name: "Βάλτε τις αυτόματα" })).toBeNull();
  });
});

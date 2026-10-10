import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../intl";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { isoDate } from "@stay-ops/domain";
import { BookingBar } from "@/ui/BookingBar";

const base = {
  guest: "Maria Konstantinou",
  checkin: isoDate("2025-10-17"),
  checkout: isoDate("2025-10-21"),
  color: "#0F766E",
  channel: "airbnb" as const,
};

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
}

describe("BookingBar", () => {
  it("default: accessible name, 56px, draggable, click", async () => {
    const onClick = vi.fn();
    const { container } = render(<BookingBar {...base} onClick={onClick} style={{ left: 10, width: 200 }} />);
    const bar = screen.getByRole("button", { name: "Maria Konstantinou, Παρ 17 – Τρι 21 Οκτ, 4 νύχτες" });
    expect(bar).toHaveClass("h-14");
    expect(bar).toHaveAttribute("data-draggable", "true");
    expect(bar.style.left).toBe("10px");
    expect(bar.style.getPropertyValue("--apt")).toBe("#0F766E");
    expect(screen.getByRole("img", { name: "Airbnb" })).toBeInTheDocument();
    await userEvent.setup().click(bar);
    expect(onClick).toHaveBeenCalledTimes(1);
    await expectNoViolations(container);
  });

  it("shows an extra detail after the nights", () => {
    render(<BookingBar {...base} detail="100 €/νύχτα" />);
    expect(screen.getByText("4 νύχτες · 100 €/νύχτα")).toBeInTheDocument();
  });

  it("is keyboard focusable and activates with Enter", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<BookingBar {...base} onClick={onClick} />);
    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["booking", "Booking.com"],
    ["direct", "Απευθείας"],
    ["other", "Άλλο κανάλι"],
  ] as const)("channel %s", async (channel, label) => {
    const { container } = render(<BookingBar {...base} channel={channel} />);
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("selected and dragging", async () => {
    const { container } = render(<BookingBar {...base} selected dragging />);
    const bar = screen.getByRole("button");
    expect(bar).toHaveAttribute("aria-pressed", "true");
    expect(bar).toHaveClass("opacity-35");
    await expectNoViolations(container);
  });

  it("pending: word shown, not draggable", async () => {
    const { container } = render(<BookingBar {...base} pending />);
    const bar = screen.getByRole("button");
    expect(bar).toHaveAttribute("data-draggable", "false");
    expect(bar).toHaveAttribute("data-state", "pending");
    expect(bar).toHaveAccessibleName(/Εκκρεμεί/);
    expect(screen.getByText(/4 νύχτες · Εκκρεμεί/)).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("needs a room", async () => {
    const { container } = render(<BookingBar {...base} needsRoom />);
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "needs-room");
    expect(screen.getByText(/Χρειάζεται διαμέρισμα/)).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("truncates visually but keeps the full name", () => {
    const long = "Αλεξάνδρα-Μαρία Παπαδοπούλου-Χατζηγεωργίου";
    render(<BookingBar {...base} guest={long} />);
    expect(screen.getByRole("button")).toHaveAccessibleName(new RegExp(long));
    expect(screen.getByRole("button")).toHaveAttribute("title", expect.stringContaining(long));
    expect(screen.getByText(long)).toHaveClass("truncate");
  });
});

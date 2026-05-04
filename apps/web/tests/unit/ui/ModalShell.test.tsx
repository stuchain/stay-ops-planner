import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ModalShell } from "@/modules/ui/ModalShell";

function ControlledModal() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      <ModalShell open={open} placement="center" title="Title" useAppShellInert={false} onRequestClose={() => setOpen(false)}>
        <button type="button">Inner</button>
      </ModalShell>
    </>
  );
}

describe("ModalShell", () => {
  it("calls onRequestClose on Escape when not busy", async () => {
    const user = userEvent.setup();
    const onRequestClose = vi.fn();
    render(
      <ModalShell open placement="center" title="T" useAppShellInert={false} onRequestClose={onRequestClose}>
        <p>Body</p>
      </ModalShell>,
    );
    await user.keyboard("{Escape}");
    expect(onRequestClose).toHaveBeenCalled();
  });

  it("does not close on Escape when busy", async () => {
    const user = userEvent.setup();
    const onRequestClose = vi.fn();
    render(
      <ModalShell open placement="center" title="T" busy useAppShellInert={false} onRequestClose={onRequestClose}>
        <p>Body</p>
      </ModalShell>,
    );
    await user.keyboard("{Escape}");
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("restores focus to the trigger when closed via Escape", async () => {
    const user = userEvent.setup();
    render(<ControlledModal />);
    const opener = screen.getByTestId("opener");
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: "Title" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Title" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps Tab focus inside the dialog", async () => {
    const user = userEvent.setup();
    const onRequestClose = vi.fn();
    render(
      <ModalShell open placement="center" title="T" useAppShellInert={false} onRequestClose={onRequestClose}>
        <button type="button">First</button>
        <button type="button">Second</button>
      </ModalShell>,
    );
    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });
    first.focus();
    await user.tab();
    expect(second).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
  });
});

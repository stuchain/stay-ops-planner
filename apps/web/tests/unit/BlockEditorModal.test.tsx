import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BlockEditorModal } from "@/modules/blocks/BlockEditorModal";

describe("BlockEditorModal", () => {
  it("shows create title and calls onClose when Cancel is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <BlockEditorModal
        open
        mode="create"
        block={null}
        rooms={[{ id: "r1", label: "R1" }]}
        defaultMonth="2026-07"
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByRole("heading", { name: "Add maintenance block" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows empty-room message when no rooms", () => {
    const onClose = vi.fn();
    render(
      <BlockEditorModal
        open
        mode="create"
        block={null}
        rooms={[]}
        defaultMonth="2026-07"
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText(/Add at least one room before creating blocks/i)).toBeInTheDocument();
  });
});

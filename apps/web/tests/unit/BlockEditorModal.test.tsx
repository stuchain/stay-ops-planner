import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockEditorModal } from "@/modules/blocks/BlockEditorModal";

describe("BlockEditorModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("shows Appendix A message when create returns CONFLICT_ASSIGNMENT", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "CONFLICT_ASSIGNMENT", message: "raw server text" } }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    ) as typeof fetch;
    render(
      <BlockEditorModal
        open
        mode="create"
        block={null}
        rooms={[{ id: "r1", label: "R1" }]}
        defaultMonth="2026-07"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(
        screen.getByText("That room is already booked for those nights."),
      ).toBeInTheDocument(),
    );
  });
});

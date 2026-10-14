// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "../intl";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { Toaster, showToast, toastDurationMs, undoToast } from "@/ui/Toast";
import { motion } from "@/ui/tokens";

afterEach(cleanup);

beforeAll(() => {
  // jsdom lacks pointer capture, which sonner calls on pointerdown.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

describe("Toast", () => {
  it("shows a message with an action and calls it", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <div id="new-ui-root">
        <Toaster />
      </div>,
    );
    act(() => {
      showToast({ message: "Αποθηκεύτηκε", tone: "success", action: { label: "Προβολή", onClick } });
    });
    expect(await screen.findByText("Αποθηκεύτηκε")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Προβολή" }));
    expect(onClick).toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.queryByText("Αποθηκεύτηκε")).toBeNull());
  });

  it("returns an id and supports every tone", () => {
    for (const tone of ["neutral", "success", "warning", "danger"] as const) {
      expect(showToast({ message: tone, tone })).toBeDefined();
    }
  });

  it("undo toast shows Αναίρεση and the warning line, and has no axe violations", async () => {
    const onUndo = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <div id="new-ui-root">
        <Toaster />
      </div>,
    );
    act(() => {
      undoToast({
        message: "Μετακινήθηκε στο Cosmos",
        warning: "Μικρό: χωράει έως 3 άτομα",
        undoLabel: "Αναίρεση",
        onUndo,
      });
    });
    expect(await screen.findByText("Μικρό: χωράει έως 3 άτομα")).toBeInTheDocument();
    expect(motion.undoMs).toBe(10_000);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Αναίρεση" }));
    expect(onUndo).toHaveBeenCalled();
    // Let sonner finish removing the toast, so its timer does not fire after the test environment is gone.
    await vi.waitFor(() => expect(screen.queryByText("Μετακινήθηκε στο Cosmos")).toBeNull());
  });

  it("keeps each tone on one duration: brief for good news, longer for problems", () => {
    expect(toastDurationMs.success).toBeLessThan(toastDurationMs.neutral);
    expect(toastDurationMs.danger).toBeGreaterThanOrEqual(toastDurationMs.neutral);
    expect(toastDurationMs.warning).toBe(toastDurationMs.danger);
  });
});

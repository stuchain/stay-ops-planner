import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DryRunPreviewModal } from "@/modules/dry-run/DryRunPreviewModal";
import type { DryRunResult } from "@stay-ops/shared";

const sampleSummary: DryRunResult = {
  dryRun: true,
  totals: {
    processed: 2,
    byAction: { update: 2 },
    byEntity: { booking: 2 },
  },
  warnings: [{ code: "W1", message: "Example warning" }],
  entries: [
    {
      index: 0,
      entityType: "booking",
      entityId: "b1",
      action: "update",
      before: { status: "confirmed" },
      after: { status: "cancelled" },
    },
  ],
  truncated: false,
};

describe("DryRunPreviewModal", () => {
  it("renders summary and calls onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <DryRunPreviewModal
        open
        title="Test preview"
        summary={sampleSummary}
        busy={false}
        executeLabel="Go"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Test preview")).toBeInTheDocument();
    expect(screen.getByText(/Example warning/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables confirm while busy", () => {
    render(
      <DryRunPreviewModal
        open
        title="Busy"
        summary={sampleSummary}
        busy
        executeLabel="Go"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CleaningBoard } from "@/modules/cleaning/CleaningBoard";

vi.mock("next/link", () => ({
  default ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) {
    return <a href={href}>{children}</a>;
  },
}));

describe("CleaningBoard", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            tasks: [
              {
                id: "ct1",
                bookingId: "bk1",
                roomId: "r1",
                status: "todo",
                taskType: "turnover",
                plannedStart: "2026-07-15T10:00:00.000Z",
                plannedEnd: "2026-07-15T12:00:00.000Z",
                assigneeName: null,
                durationMinutes: 120,
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders board shell, filters, and todo start control", async () => {
    render(<CleaningBoard />);
    await waitFor(() => expect(screen.queryByText(/Loading tasks/i)).not.toBeInTheDocument());
    expect(screen.getByTestId("ops-cleaning-board")).toBeInTheDocument();
    expect(screen.getByLabelText(/Day \(planned start\)/i)).toBeInTheDocument();
    expect(screen.getByTestId("ops-cleaning-start-ct1")).toBeInTheDocument();
  });
});

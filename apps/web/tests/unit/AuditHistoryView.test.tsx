import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditHistoryView } from "@/modules/audit/ui/AuditHistoryView";

describe("AuditHistoryView", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "http://localhost");
      const entityType = url.searchParams.get("entityType");
      const page2 = url.searchParams.get("cursor");

      if (entityType === "assignment" && !page2) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "a1",
                actorUserId: "u1",
                action: "assignment.reassign",
                entityType: "assignment",
                entityId: "asg-1",
                beforeJson: { roomId: "r1" },
                afterJson: { roomId: "r2" },
                metaJson: { bookingId: "b1" },
                createdAt: "2026-04-01T00:00:00.000Z",
                redacted: false,
              },
            ],
            page: { nextCursor: "next-1", limit: 20 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (entityType === "assignment" && page2) {
        return new Response(
          JSON.stringify({
            data: [],
            page: { nextCursor: null, limit: 20 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ data: [], page: { nextCursor: null, limit: 20 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies filters and renders selected row details", async () => {
    const user = userEvent.setup();
    render(<AuditHistoryView />);

    await user.type(screen.getByLabelText(/Entity type/i), "assignment");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /2026-04-01T00:00:00.000Z · assignment\.reassign · assignment\/asg-1/i }),
      ).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", { name: /2026-04-01T00:00:00.000Z · assignment\.reassign · assignment\/asg-1/i }),
    );
    expect(screen.getByText(/Event detail/i)).toBeInTheDocument();
    expect(screen.getByText(/"entityId": "asg-1"/i)).toBeInTheDocument();
  });
});

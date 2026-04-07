import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminConfigurationView } from "@/modules/admin-configuration/ui/AdminConfigurationView";

describe("AdminConfigurationView", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "http://localhost");

      if (url.pathname === "/api/admin/config/templates" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/api/admin/config/thresholds" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/api/admin/config/templates" && init?.method === "POST") {
        return new Response(JSON.stringify({ data: { id: "tpl_1" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/api/admin/config/thresholds" && init?.method === "POST") {
        return new Response(JSON.stringify({ data: { id: "thr_1" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: { message: "Unhandled fetch" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders configuration sections and saves template/threshold", async () => {
    const user = userEvent.setup();
    render(<AdminConfigurationView />);

    await waitFor(() => expect(screen.getByText(/Alert template configuration/i)).toBeInTheDocument());
    expect(screen.getByText(/Operational threshold configuration/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Body$/i), "Template body");
    await user.click(screen.getByRole("button", { name: /Save template/i }));

    await user.clear(screen.getByLabelText(/Numeric value/i));
    await user.type(screen.getByLabelText(/Numeric value/i), "9");
    await user.click(screen.getByRole("button", { name: /Save threshold/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/admin/config/templates",
        expect.objectContaining({ method: "POST" }),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/admin/config/thresholds",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});

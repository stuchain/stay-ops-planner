// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineKey } from "@/api/offlineCache";
import { LogoutButton } from "@/features/shell/LogoutButton";
import { fireEvent, render, screen, waitFor } from "../intl";

const assign = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("signing out", () => {
  it("erases the kept bookings before leaving, even if the sign-out request fails", async () => {
    window.localStorage.setItem(offlineKey("me"), '{"secret":"booking"}');
    window.localStorage.setItem(offlineKey("other"), "{}");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LogoutButton />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(window.localStorage.getItem(offlineKey("me"))).toBeNull();
    expect(window.localStorage.getItem(offlineKey("other"))).toBeNull();
  });
});

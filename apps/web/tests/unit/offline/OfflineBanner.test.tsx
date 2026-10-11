// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isOnline, reportNetworkFailure, reportNetworkWorks, resetOnlineState, useOnline } from "@/api/online";
import { makeQueryClient } from "@/api/queryClient";
import { newestDataTime, OfflineBanner } from "@/features/shell/OfflineBanner";
import { render, screen } from "../intl";

function setNavigatorOnline(value: boolean) {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetOnlineState();
});

describe("useOnline", () => {
  it("follows the browser's online and offline events", () => {
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  it("is off after a network failure although the browser says online, and back after a success", () => {
    const { result } = renderHook(() => useOnline());
    act(() => reportNetworkFailure());
    expect(result.current).toBe(false);
    expect(isOnline()).toBe(false);
    act(() => reportNetworkWorks());
    expect(result.current).toBe(true);
  });

  it("the online event clears a failure seen earlier", () => {
    const { result } = renderHook(() => useOnline());
    act(() => reportNetworkFailure());
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  it("a failed read with no connection turns it off; a server answer does not", async () => {
    const { TRPCClientError } = await import("@trpc/client");
    const client = makeQueryClient();
    const { result } = renderHook(() => useOnline());
    await act(async () => {
      await client.fetchQuery({ queryKey: ["a"], queryFn: () => Promise.reject(new Error("boom")), retry: false }).catch(() => {});
    });
    expect(result.current).toBe(true);
    await act(async () => {
      await client
        .fetchQuery({
          queryKey: ["b"],
          queryFn: () => Promise.reject(new TRPCClientError("Failed to fetch")),
          retry: false,
        })
        .catch(() => {});
    });
    expect(result.current).toBe(false);
    await act(async () => {
      await client.fetchQuery({ queryKey: ["c"], queryFn: () => Promise.resolve(1), retry: false });
    });
    expect(result.current).toBe(true);
  });

  it("makes writes fail at once instead of waiting in a queue", () => {
    expect(makeQueryClient().getDefaultOptions().mutations?.networkMode).toBe("always");
  });
});

function withData(updatedAt: number) {
  const queryClient = new QueryClient();
  queryClient.setQueryData([["today", "summary"], { type: "query" }], { ok: true }, { updatedAt });
  queryClient.setQueryData([["me", "get"], { type: "query" }], { ok: true }, { updatedAt: updatedAt + 60_000 });
  return queryClient;
}

function renderBanner(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <OfflineBanner />
    </QueryClientProvider>,
  );
}

describe("OfflineBanner", () => {
  it("shows nothing while online", () => {
    renderBanner(withData(Date.now()));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says the data is from the newest Today or Calendar answer, not a small query", () => {
    const at = new Date();
    at.setUTCHours(11, 32, 0, 0); // 14:32 in Athens (summer time)
    setNavigatorOnline(false);
    renderBanner(withData(at.getTime()));
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Χωρίς σύνδεση στο ίντερνετ.");
    expect(banner.textContent).toContain("14:32");
    expect(banner.textContent).toContain("Δεν μπορείτε να κάνετε αλλαγές μέχρι να επανέλθει.");
  });

  it("appears when the connection drops while open, and goes when it is back", () => {
    renderBanner(withData(Date.now()));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("appears after a network error and says so without a time when nothing was loaded", () => {
    renderBanner(new QueryClient());
    act(() => reportNetworkFailure());
    expect(screen.getByRole("status").textContent).toBe(
      "Χωρίς σύνδεση στο ίντερνετ. Δεν μπορείτε να κάνετε αλλαγές μέχρι να επανέλθει.",
    );
  });

  it("is in English too", () => {
    setNavigatorOnline(false);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OfflineBanner />
      </QueryClientProvider>,
      { locale: "en" },
    );
    expect(screen.getByRole("status").textContent).toContain("No internet connection");
  });
});

describe("newestDataTime", () => {
  it("looks only at Today and Calendar answers", () => {
    const q = (path: string[], at: number) => ({ queryKey: [path, {}], state: { dataUpdatedAt: at } });
    expect(newestDataTime([q(["today", "summary"], 5), q(["calendar", "range"], 9), q(["me", "get"], 99)])).toBe(9);
    expect(newestDataTime([q(["me", "get"], 99)])).toBe(0);
    expect(newestDataTime([])).toBe(0);
  });
});

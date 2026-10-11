// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOfflineCache,
  createOfflinePersister,
  dropOtherUsersCache,
  offlineKey,
  procedureOf,
  shouldPersistQuery,
} from "@/api/offlineCache";

function query(path: string[], status: "success" | "error" | "pending" = "success") {
  return {
    queryKey: [path, { type: "query" }],
    state: { status, data: status === "success" ? {} : undefined },
  } as never;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("which answers are kept for offline reading", () => {
  it("reads the procedure name out of a tRPC query key", () => {
    expect(procedureOf([["calendar", "range"], { input: {}, type: "query" }])).toBe("calendar.range");
    expect(procedureOf(["something"])).toBeNull();
    expect(procedureOf([])).toBeNull();
  });

  it("keeps Today, Calendar and the small queries they need", () => {
    for (const path of [["today", "summary"], ["calendar", "range"], ["sync", "status"], ["me", "get"]]) {
      expect(shouldPersistQuery(query(path))).toBe(true);
    }
  });

  it("keeps nothing else: money, history, messages, dev screens, help", () => {
    for (const path of [
      ["money", "ledger"],
      ["booking", "history"],
      ["booking", "details"],
      ["booking", "messageTemplates"],
      ["calendar", "arrangePreview"],
      ["dev", "users"],
    ]) {
      expect(shouldPersistQuery(query(path))).toBe(false);
    }
  });

  it("keeps only finished answers, not errors or loading queries", () => {
    expect(shouldPersistQuery(query(["today", "summary"], "error"))).toBe(false);
    expect(shouldPersistQuery(query(["today", "summary"], "pending"))).toBe(false);
  });
});

describe("the kept copy in this browser", () => {
  it("is stored under a key of the user", async () => {
    const persister = createOfflinePersister("user-1");
    persister.persistClient({ timestamp: 1, buster: "x", clientState: { mutations: [], queries: [] } });
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(window.localStorage.getItem(offlineKey("user-1"))).toContain('"buster":"x"');
  });

  it("drops what another person left behind, and keeps the user's own", () => {
    window.localStorage.setItem(offlineKey("old"), "{}");
    window.localStorage.setItem(offlineKey("me"), "{}");
    window.localStorage.setItem("unrelated", "keep");
    dropOtherUsersCache("me");
    expect(window.localStorage.getItem(offlineKey("old"))).toBeNull();
    expect(window.localStorage.getItem(offlineKey("me"))).toBe("{}");
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });

  it("is erased on sign-out, in storage and in memory, and cannot be written again", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData([["today", "summary"], { type: "query" }], { bookings: ["secret"] });
    window.localStorage.setItem(offlineKey("me"), "{}");
    window.localStorage.setItem("unrelated", "keep");
    const persister = createOfflinePersister("me");
    clearOfflineCache(queryClient);
    expect(window.localStorage.getItem(offlineKey("me"))).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    // A write that was waiting for its turn must not bring the data back.
    persister.persistClient({ timestamp: 1, buster: "x", clientState: { mutations: [], queries: [] } });
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(window.localStorage.getItem(offlineKey("me"))).toBeNull();
  });

  it("does not throw when storage is blocked", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => clearOfflineCache()).not.toThrow();
      expect(() => dropOtherUsersCache("me")).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});

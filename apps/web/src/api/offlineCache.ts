import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { defaultShouldDehydrateQuery, type Query, type QueryClient } from "@tanstack/react-query";

/**
 * Offline reading (P4-8): the answers behind Today and Calendar are kept in this browser, so when the internet
 * drops he still sees the last data. Only these tRPC procedures are kept (nothing about money, guest messages,
 * dev screens or history).
 */
export const OFFLINE_PROCEDURES: readonly string[] = ["today.summary", "calendar.range", "sync.status", "me.get"];

/** The screens' own data, used for the "data from HH:MM" time (the small ones are refreshed by every page). */
export const SCREEN_PROCEDURES: readonly string[] = ["today.summary", "calendar.range"];

export const OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const KEY_PREFIX = "stay-ops:offline:";

/** A new deploy has its own release name, so answers shaped by an older version are dropped. */
export const OFFLINE_BUSTER = process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? "dev";

/** "today.summary" for a tRPC query key like `[["today","summary"], {type:"query"}]`. */
export function procedureOf(queryKey: readonly unknown[]): string | null {
  const path = queryKey[0];
  return Array.isArray(path) && path.length > 0 && path.every((p) => typeof p === "string") ? path.join(".") : null;
}

/** Keeps only finished answers of the procedures above. */
export function shouldPersistQuery(query: Pick<Query, "queryKey" | "state">): boolean {
  const procedure = procedureOf(query.queryKey);
  return procedure !== null && OFFLINE_PROCEDURES.includes(procedure) && defaultShouldDehydrateQuery(query as Query);
}

export function offlineKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** After a sign-out the throttled writer must not put the data back before the page is left. */
let writesBlocked = false;

/** localStorage that never throws (private windows, blocked storage) and stops writing after a sign-out. */
const guardedStorage = {
  getItem(key: string): string | null {
    try {
      return browserStorage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    if (writesBlocked) return;
    try {
      browserStorage()?.setItem(key, value);
    } catch {
      // Full or blocked: reading offline then simply has less to show.
    }
  },
  removeItem(key: string) {
    try {
      browserStorage()?.removeItem(key);
    } catch {
      // Nothing to do.
    }
  },
};

export function createOfflinePersister(userId: string) {
  writesBlocked = false;
  return createSyncStoragePersister({ storage: guardedStorage, key: offlineKey(userId), throttleTime: 2000 });
}

function removeKeys(keep?: string) {
  const storage = browserStorage();
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(KEY_PREFIX) && key !== keep) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** Leftovers of another person who used this computer. */
export function dropOtherUsersCache(userId: string) {
  removeKeys(offlineKey(userId));
}

/**
 * Sign-out (or somebody else signing in): forget every kept answer, in memory and in storage, so the next person
 * on the computer cannot see bookings.
 */
export function clearOfflineCache(queryClient?: QueryClient) {
  writesBlocked = true;
  queryClient?.clear();
  removeKeys();
}

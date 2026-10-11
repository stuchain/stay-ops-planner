"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether changes can be sent right now (P4-8). It is false when the browser says it is offline, or when a request
 * just failed with a network error (a dead Wi-Fi often still says "online"). It is true again after the browser's
 * `online` event or the next request that gets through.
 */

let networkFailed = false;
let listening = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function onBrowserChange(event: Event) {
  // Coming back online clears a failure seen earlier; going offline needs no flag, the browser says it.
  if (event.type === "online") networkFailed = false;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (!listening && typeof window !== "undefined") {
    window.addEventListener("online", onBrowserChange);
    window.addEventListener("offline", onBrowserChange);
    listening = true;
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && listening && typeof window !== "undefined") {
      window.removeEventListener("online", onBrowserChange);
      window.removeEventListener("offline", onBrowserChange);
      listening = false;
    }
  };
}

/** The current answer, for code that is not a component. */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false && !networkFailed;
}

/** A request failed because there was no network. */
export function reportNetworkFailure() {
  if (networkFailed) return;
  networkFailed = true;
  notify();
}

/** A request got an answer from the server, so the connection works. */
export function reportNetworkWorks() {
  if (!networkFailed) return;
  networkFailed = false;
  notify();
}

/** Test helper: forget a reported failure. */
export function resetOnlineState() {
  networkFailed = false;
  notify();
}

/** `false` while offline: screens turn their buttons that change data off. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}

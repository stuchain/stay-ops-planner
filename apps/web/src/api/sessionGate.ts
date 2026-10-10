/**
 * When the session runs out, requests wait here until the person signs in again in place (E2-1), so an open form
 * keeps what was typed and the save goes through afterwards. Without a sign-in dialog on the page, nothing waits.
 */

export type SessionGateState = { open: boolean; reason: "expired" | "ending" };

type Waiter = { resolve: () => void; reject: () => void };

const CLOSED: SessionGateState = { open: false, reason: "expired" };

let state: SessionGateState = CLOSED;
let waiters: Waiter[] = [];
const listeners = new Set<() => void>();

function setState(next: SessionGateState) {
  state = next;
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`; the dialog subscribes, and while it does, requests may wait for a sign-in. */
export function subscribeSessionGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function sessionGateState(): SessionGateState {
  return state;
}

/**
 * Resolves once the person has signed in again, rejects with `error` if they leave instead.
 * Rejects at once when no dialog is listening, so a request never waits for nothing.
 */
export function waitForSignIn(error: unknown): Promise<void> {
  if (listeners.size === 0) return Promise.reject(error);
  return new Promise<void>((resolve, reject) => {
    waiters.push({ resolve, reject: () => reject(error) });
    if (!state.open || state.reason !== "expired") setState({ open: true, reason: "expired" });
  });
}

/** Opens the dialog before the session ends, so signing in again starts a fresh 12 hours. */
export function askToSignInEarly() {
  if (!state.open) setState({ open: true, reason: "ending" });
}

/** Signed in again: waiting requests are retried. */
export function signedIn() {
  const pending = waiters;
  waiters = [];
  setState(CLOSED);
  for (const waiter of pending) waiter.resolve();
}

/** Closed without signing in: waiting requests fail with their original error. */
export function signInDismissed() {
  const pending = waiters;
  waiters = [];
  setState(CLOSED);
  for (const waiter of pending) waiter.reject();
}

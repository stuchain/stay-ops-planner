/** The last error sentence shown on screen, for the "Στείλε στον Στέλιο" message (P4-11). Kept in memory only. */
let last: { text: string; at: string } | null = null;

export function rememberError(text: string, now: Date = new Date()): void {
  last = { text: text.slice(0, 500), at: now.toISOString() };
}

export function lastShownError(): { text: string; at: string } | null {
  return last;
}

/** For tests. */
export function forgetErrors(): void {
  last = null;
}

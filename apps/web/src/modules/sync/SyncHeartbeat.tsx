"use client";

import { useEffect } from "react";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

async function triggerReconcile() {
  const res = await fetch("/api/sync/hosthub/reconcile", {
    method: "POST",
    credentials: "include",
    headers: { "X-StayOps-Sync-Trigger": "heartbeat" },
  }).catch(() => null);
  if (res && res.status === 200) {
    const body = (await res.json().catch(() => null)) as { data?: { status?: string; reason?: string } } | null;
    const skipped = body?.data?.status === "skipped";
    if (!skipped) {
      window.dispatchEvent(new CustomEvent("ops:hosthub-sync-tick"));
    }
  }
  // 409 overlap and debounced skips: no tick (avoid reload storms).
}

export function SyncHeartbeat() {
  useEffect(() => {
    void triggerReconcile();
    const timer = window.setInterval(() => {
      void triggerReconcile();
    }, FIFTEEN_MIN_MS);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}

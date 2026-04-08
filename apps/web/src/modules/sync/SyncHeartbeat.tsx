"use client";

import { useEffect } from "react";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

async function triggerReconcile() {
  const res = await fetch("/api/sync/hosthub/reconcile", {
    method: "POST",
    credentials: "include",
  }).catch(() => null);
  if (res && (res.status === 200 || res.status === 202)) {
    window.dispatchEvent(new CustomEvent("ops:hosthub-sync-tick"));
  }
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

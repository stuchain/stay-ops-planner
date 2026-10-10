"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTRPC } from "@/api/client";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/**
 * Hosthub syncs only while the app is open: once on open and every 15 minutes (the server
 * debounces and locks). After a sync that ran, calendar data and the "last updated" line refresh.
 */
export function useSyncWhileOpen(): void {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const res = await fetch("/api/sync/hosthub/reconcile", {
        method: "POST",
        credentials: "include",
        headers: { "X-StayOps-Sync-Trigger": "heartbeat" },
      }).catch(() => null);
      if (cancelled || !res || res.status !== 200) return;
      const body = (await res.json().catch(() => null)) as { data?: { status?: string } } | null;
      if (body?.data?.status === "skipped") return;
      void queryClient.invalidateQueries({ queryKey: trpc.calendar.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.sync.pathKey() });
    }
    void tick();
    const timer = window.setInterval(() => void tick(), FIFTEEN_MIN_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [queryClient, trpc]);
}

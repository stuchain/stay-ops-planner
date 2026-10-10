"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useTRPC } from "@/api/client";

/** "πριν από 5 λεπτά" style text for how long ago something happened. */
export function agoText(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "μόλις τώρα";
  if (minutes === 1) return "πριν από 1 λεπτό";
  if (minutes < 60) return `πριν από ${minutes} λεπτά`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "πριν από 1 ώρα";
  if (hours < 24) return `πριν από ${hours} ώρες`;
  const days = Math.round(hours / 24);
  return days === 1 ? "πριν από 1 μέρα" : `πριν από ${days} μέρες`;
}

/** The Hosthub "last updated" line at the bottom of the sidebar. */
export function SyncIndicator() {
  const trpc = useTRPC();
  const status = useQuery({ ...trpc.sync.status.queryOptions(), refetchInterval: 60_000 });
  if (!status.data) return <span>Ενημέρωση από Hosthub…</span>;
  return (
    <span className="flex items-start gap-2" aria-live="polite">
      <RefreshCw
        size={20}
        strokeWidth={2}
        aria-hidden="true"
        className={status.data.running ? "motion-safe:animate-spin" : undefined}
      />
      <span>
        {status.data.running
          ? "Ενημέρωση από Hosthub τώρα…"
          : status.data.lastSuccessAt
            ? `Τελευταία ενημέρωση από Hosthub: ${agoText(status.data.lastSuccessAt)}`
            : "Δεν έχει γίνει ακόμα ενημέρωση από Hosthub"}
      </span>
    </span>
  );
}

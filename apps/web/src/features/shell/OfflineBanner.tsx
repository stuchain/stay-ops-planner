"use client";

import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useSyncExternalStore } from "react";
import { procedureOf, SCREEN_PROCEDURES } from "@/api/offlineCache";
import { useOnline } from "@/api/online";

/**
 * Shown on every screen while there is no internet (P4-8): the screens keep showing the last data, and this says
 * from when it is and that changes wait for the connection.
 */
export function OfflineBanner() {
  const t = useTranslations("offline");
  const format = useFormatter();
  const online = useOnline();
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();

  // The newest time any screen data was received (a number, so React can compare it between renders).
  const subscribe = useCallback((listener: () => void) => cache.subscribe(listener), [cache]);
  const newest = useSyncExternalStore(
    subscribe,
    () => newestDataTime(cache.getAll()),
    () => 0,
  );

  if (online) return null;
  let text = t("bannerNoTime");
  if (newest > 0) {
    const when = new Date(newest);
    const sameDay = when.toDateString() === new Date().toDateString();
    const time = sameDay
      ? format.dateTime(when, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      : format.dateTime(when, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    text = t("banner", { time });
  }
  return (
    <div
      role="status"
      className="bg-warning-soft text-warning-text border-warning flex items-start gap-3 border-b-2 px-6 py-3 text-base font-medium print:hidden"
    >
      <WifiOff size={24} className="shrink-0" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

/** When the newest answer of Today or Calendar arrived; 0 if there is none. */
export function newestDataTime(
  queries: ReadonlyArray<{ queryKey: readonly unknown[]; state: { dataUpdatedAt: number } }>,
) {
  let newest = 0;
  for (const query of queries) {
    const procedure = procedureOf(query.queryKey);
    if (procedure && SCREEN_PROCEDURES.includes(procedure)) newest = Math.max(newest, query.state.dataUpdatedAt);
  }
  return newest;
}

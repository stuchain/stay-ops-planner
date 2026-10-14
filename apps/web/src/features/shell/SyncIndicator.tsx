"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";

export type Ago = { unit: "now" } | { unit: "minutes" | "hours" | "days"; count: number };

/** How long ago something happened, rounded to the unit a person would say ("πριν από 5 λεπτά"). */
export function agoParts(iso: string, now: Date = new Date()): Ago {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return { unit: "now" };
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.round(hours / 24) };
}

/** "πριν από 5 λεπτά" in the user's language. */
export function useAgoText(): (iso: string, now?: Date) => string {
  const t = useTranslations("common.ago");
  return (iso, now) => {
    const ago = agoParts(iso, now);
    return ago.unit === "now" ? t("now") : t(ago.unit, { count: ago.count });
  };
}

/** After this long without a successful update the line shows, even when no error was recorded. */
export const STALE_AFTER_MS = 24 * 60 * 60_000;

/** The Hosthub line at the bottom of the sidebar. Silent while all is well; it only speaks up when an update
 * failed or none succeeded for a day, so the father never reads about Hosthub for nothing. A broken key is
 * the banner's job (HosthubBanner), not this line's. */
export function SyncIndicator({ now = Date.now() }: { now?: number }) {
  const t = useTranslations("sync");
  const agoText = useAgoText();
  const trpc = useTRPC();
  const status = useQuery({ ...trpc.sync.status.queryOptions(), refetchInterval: 60_000 });
  const data = status.data;
  if (!data || data.running || data.problem === "auth") return null;
  const last = data.lastSuccessAt;
  const stale = last === null || now - new Date(last).getTime() > STALE_AFTER_MS;
  if (data.problem !== "other" && !stale) return null;
  const text =
    data.problem === "other"
      ? last
        ? t("failed", { ago: agoText(last) })
        : t("failedNever")
      : last
        ? t("lastSuccess", { ago: agoText(last) })
        : t("never");
  return (
    <span className="text-warning-text flex items-start gap-2" aria-live="polite">
      <RefreshCw size={20} strokeWidth={2} aria-hidden="true" className="flex-none" />
      <span>{text}</span>
    </span>
  );
}

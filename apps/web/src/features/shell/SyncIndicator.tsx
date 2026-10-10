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

/** The Hosthub "last updated" line at the bottom of the sidebar. */
export function SyncIndicator() {
  const t = useTranslations("sync");
  const agoText = useAgoText();
  const trpc = useTRPC();
  const status = useQuery({ ...trpc.sync.status.queryOptions(), refetchInterval: 60_000 });
  if (!status.data) return <span>{t("loading")}</span>;
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
          ? t("running")
          : status.data.lastSuccessAt
            ? t("lastSuccess", { ago: agoText(status.data.lastSuccessAt) })
            : t("never")}
      </span>
    </span>
  );
}

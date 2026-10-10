"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { cn } from "@/ui/cn";

/**
 * Shown on every screen when the last Hosthub sync was refused (E2-8). Admins get a button to Settings;
 * everyone else is told whom to ask.
 */
export function HosthubBanner() {
  const t = useTranslations("session");
  const pathname = usePathname();
  const trpc = useTRPC();
  const status = useQuery({ ...trpc.sync.status.queryOptions(), refetchInterval: 60_000 });
  const me = useQuery(trpc.me.get.queryOptions());
  if (status.data?.problem !== "auth" || !me.data) return null;
  const isAdmin = me.data.role === "admin";
  const onSettings = pathname?.startsWith("/app/settings") ?? false;
  return (
    <div
      role="alert"
      className="bg-warning-soft text-warning-text border-warning flex flex-wrap items-center justify-between gap-3 border-b-2 px-6 py-3"
    >
      <p className="flex items-start gap-3 text-base">
        <TriangleAlert size={24} className="shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold">{t("hosthubStopped")}</strong>
          <span className="block">
            {t("hosthubStoppedBody")}
            {isAdmin ? null : ` ${t("askStelios")}`}
          </span>
        </span>
      </p>
      {isAdmin && !onSettings ? (
        <Link href="/app/settings" className={cn(buttonBase, buttonVariants.secondary, buttonSizes.md)}>
          {t("goToSettings")}
        </Link>
      ) : null}
    </div>
  );
}

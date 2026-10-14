"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { useHydrated } from "@/api/useHydrated";
import { ErrorState } from "@/ui/ErrorState";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { HosthubTokenCard } from "@/features/dev/HosthubScreen";
import { CalendarFeedCard } from "./CalendarFeedCard";
import { DevModeCard } from "./DevModeCard";
import { FamilyCard } from "./FamilyCard";
import { HosthubCard } from "./HosthubCard";
import { LanguageCard } from "./LanguageCard";
import { PasswordCard } from "./PasswordCard";
import { TextSizeCard, toTextSize } from "./TextSizeCard";

/**
 * /app/settings: text size, phone calendar, password (folded) and language (folded) for everyone; the Hosthub
 * connection, family accounts and Dev mode for admins only.
 */
export function SettingsScreen() {
  const t = useTranslations("settingsScreen");
  const tp = useTranslations("polish");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const query = useQuery(trpc.me.get.queryOptions());
  // The offline copy can restore `me` before hydration ends; the server rendered it as still loading.
  const hydrated = useHydrated();
  const me = { ...query, data: hydrated ? query.data : undefined };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader title={t("title")} />
      {me.isError ? (
        <ErrorState message={errorText(me.error)} onRetry={() => void me.refetch()} />
      ) : !me.data ? (
        <div role="status" aria-label={tp("loading")} className="flex flex-col gap-6">
          <Skeleton variant="block" className="h-40" />
          <Skeleton variant="block" className="h-40" />
          <Skeleton variant="block" className="h-40" />
        </div>
      ) : (
        <>
          <TextSizeCard textSize={toTextSize(me.data.textSize)} />
          <CalendarFeedCard />
          <PasswordCard />
          <LanguageCard locale={me.data.locale === "en" ? "en" : "el"} />
          {me.data.role === "admin" ? (
            <>
              <HosthubCard canRefresh />
              <HosthubTokenCard />
              <FamilyCard />
              <DevModeCard enabled={me.data.devMode} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

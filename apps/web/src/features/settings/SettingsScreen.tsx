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

/** /app/settings for the new UI: language, text size, Hosthub, phone calendar, password and (admins) Dev mode. */
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
      <PageHeader title={t("title")} subtitle={me.data ? t("signedInAs", { email: me.data.email }) : undefined} />
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
          <LanguageCard locale={me.data.locale === "en" ? "en" : "el"} />
          <TextSizeCard textSize={toTextSize(me.data.textSize)} />
          <HosthubCard canRefresh={me.data.role !== "viewer"} />
          {me.data.role === "admin" ? <HosthubTokenCard /> : null}
          <CalendarFeedCard />
          <PasswordCard />
          {me.data.role === "admin" ? <FamilyCard /> : null}
          {me.data.role === "admin" ? <DevModeCard enabled={me.data.devMode} /> : null}
        </>
      )}
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { ErrorState } from "@/ui/ErrorState";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { DevModeCard } from "./DevModeCard";
import { HosthubCard } from "./HosthubCard";
import { LanguageCard } from "./LanguageCard";
import { PasswordCard } from "./PasswordCard";
import { TextSizeCard, toTextSize } from "./TextSizeCard";

/** /app/settings for the new UI: language, text size, Hosthub, password and (admins) Dev mode. */
export function SettingsScreen() {
  const t = useTranslations("settingsScreen");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const me = useQuery(trpc.me.get.queryOptions());

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader title={t("title")} subtitle={me.data ? t("signedInAs", { email: me.data.email }) : undefined} />
      {me.isError ? (
        <ErrorState message={errorText(me.error)} onRetry={() => void me.refetch()} />
      ) : !me.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <LanguageCard locale={me.data.locale === "en" ? "en" : "el"} />
          <TextSizeCard textSize={toTextSize(me.data.textSize)} />
          <HosthubCard canRefresh={me.data.role !== "viewer"} />
          <PasswordCard />
          {me.data.role === "admin" ? <DevModeCard enabled={me.data.devMode} /> : null}
        </>
      )}
    </div>
  );
}

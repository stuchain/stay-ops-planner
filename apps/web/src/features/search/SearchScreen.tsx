"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { isIsoDate, type IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { SearchResultData } from "@/api/types";
import { fieldClass } from "@/ui/field";
import { Badge } from "@/ui/Badge";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { DateText } from "@/ui/DateText";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";

const inputClass = `${fieldClass} w-full`;

/** The typed text, sent once the person stops typing for a moment. */
function useSettled<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

const dateOrNull = (value: string | null | undefined): IsoDate | null => (value && isIsoDate(value) ? value : null);

function ResultRow({ result }: { result: SearchResultData }) {
  const t = useTranslations("search");
  const common = useTranslations("common");
  const tStatus = useTranslations("bookingStatus");
  const tChannel = useTranslations("channel");
  const cancelled = result.status === "cancelled";
  const pending = result.status === "pending";
  const people = result.partySize === null ? common("unknownPeople") : common("people", { count: result.partySize });
  const name = result.guestName ?? common("noName");
  return (
    <li>
      <Link
        href={`/app/calendar?booking=${result.id}&date=${result.checkin}`}
        className={cn(
          "min-h-target hover:bg-surface-muted border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-sm border px-4 py-3",
          (cancelled || pending) && "bg-surface-muted text-text-muted border-dashed",
        )}
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-lg font-semibold">{name}</span>
          <span className="text-base">
            <DateText date={result.checkin} to={result.checkout} withYear showNights />
            {" · "}
            {people}
          </span>
          <span className="text-text-muted text-sm">
            {tChannel(result.channel)}
            {result.phone ? ` · ${result.phone}` : null}
          </span>
          {cancelled || pending ? (
            <span className="text-warning-text text-sm font-semibold">
              {tStatus(cancelled ? "cancelled" : "pending")}
            </span>
          ) : null}
        </span>
        {result.room ? <ApartmentChip name={result.room.name} /> : <Badge tone="warning">{t("noApartment")}</Badge>}
      </Link>
    </li>
  );
}

/** "Αναζήτηση": any booking, past or future, by guest name, phone, e-mail or dates. Read-only. */
export function SearchScreen() {
  const t = useTranslations("search");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const ids = useId();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [text, setText] = useState(() => params?.get("q") ?? "");
  const [from, setFrom] = useState<IsoDate | null>(() => dateOrNull(params?.get("from")));
  const [to, setTo] = useState<IsoDate | null>(() => dateOrNull(params?.get("to")));
  const [includeCancelled, setIncludeCancelled] = useState(() => params?.get("cancelled") === "1");
  const settledText = useSettled(text.trim());

  // The search stays in the address, so coming back from the calendar shows the same results.
  useEffect(() => {
    const next = new URLSearchParams();
    if (settledText) next.set("q", settledText);
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    if (includeCancelled) next.set("cancelled", "1");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : (pathname ?? "/app/search"), { scroll: false });
  }, [settledText, from, to, includeCancelled, router, pathname]);

  const hasQuery = settledText.length >= 2 || from !== null || to !== null;
  const search = useQuery({
    ...trpc.booking.search.queryOptions({
      ...(settledText ? { text: settledText } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(includeCancelled ? { includeCancelled: true } : {}),
    }),
    enabled: hasQuery,
    placeholderData: keepPreviousData,
  });

  const clear = () => {
    setText("");
    setFrom(null);
    setTo(null);
  };

  return (
    <div className="flex flex-col gap-6 p-8 phone:p-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Card>
        <form
          role="search"
          className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] items-end gap-4 narrow:grid-cols-1"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor={`${ids}-q`} className="text-base font-semibold">
              {t("textLabel")}
            </label>
            <input
              id={`${ids}-q`}
              type="search"
              autoFocus
              autoComplete="off"
              className={inputClass}
              placeholder={t("textPlaceholder")}
              value={text}
              maxLength={100}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor={`${ids}-from`} className="text-base font-semibold">
              {t("from")}
            </label>
            <input
              id={`${ids}-from`}
              type="date"
              className={inputClass}
              value={from ?? ""}
              onChange={(e) => setFrom(dateOrNull(e.target.value))}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor={`${ids}-to`} className="text-base font-semibold">
              {t("to")}
            </label>
            <input
              id={`${ids}-to`}
              type="date"
              className={inputClass}
              value={to ?? ""}
              min={from ?? undefined}
              onChange={(e) => setTo(dateOrNull(e.target.value))}
            />
          </div>
          <div className="col-span-full flex flex-wrap items-center gap-4">
            <label className="min-h-target flex items-center gap-2 text-base">
              <input
                type="checkbox"
                className="size-5"
                checked={includeCancelled}
                onChange={(e) => setIncludeCancelled(e.target.checked)}
              />
              {t("includeCancelled")}
            </label>
            {text || from || to ? (
              <Button type="button" variant="ghost" onClick={clear}>
                {t("clear")}
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {!hasQuery ? (
        <EmptyState icon={Search} title={t("emptyTitle")} text={t("emptyText")} />
      ) : search.isPending ? (
        <div role="status" aria-label={t("loading")} className="flex flex-col gap-2">
          <Skeleton variant="block" className="h-20" />
          <Skeleton variant="block" className="h-20" />
          <Skeleton variant="block" className="h-20" />
        </div>
      ) : search.isError ? (
        <ErrorState message={errorText(search.error)} onRetry={() => void search.refetch()} />
      ) : (
        <section aria-label={t("results")} className="flex flex-col gap-3">
          <p role="status" className="text-lg font-semibold">
            {search.data.results.length === 0
              ? t("none")
              : search.data.more
                ? t("countMore", { count: search.data.results.length })
                : t("count", { count: search.data.results.length })}
          </p>
          <ul className="flex flex-col gap-2">
            {search.data.results.map((result) => (
              <ResultRow key={result.id} result={result} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

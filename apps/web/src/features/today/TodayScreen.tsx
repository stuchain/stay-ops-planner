"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CircleAlert, Printer, StickyNote } from "lucide-react";
import Link from "next/link";
import type { IsoDate } from "@stay-ops/domain";
import { useLocale, useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { TodayGap, TodayStay, TodaySummary } from "@/api/types";
import { arrivalCardsHref } from "@/features/arrivalCards/ids";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { DateText } from "@/ui/DateText";
import { ErrorState } from "@/ui/ErrorState";
import { PageHeader } from "@/ui/PageHeader";
import { formatDay, type UiLocale } from "@/ui/format";
import { Skeleton } from "@/ui/Skeleton";

/** Which line goes under the guest's name. */
type Line = "arrival" | "departure";

function StayRow({ stay, line, showKind = false }: { stay: TodayStay; line: Line; showKind?: boolean }) {
  const t = useTranslations("today");
  const common = useTranslations("common");
  const notes = useTranslations("guestNotes");
  const noteLines = stay.guestNotes.map((note) => notes("onToday", { note }));
  const pending = stay.status === "pending";
  const people = stay.partySize === null ? common("unknownPeople") : common("people", { count: stay.partySize });
  const nights = common("nights", { count: stay.nights });
  const name = stay.guestName ?? common("noName");
  return (
    <li>
      <Link
        href={`/app/calendar?booking=${stay.id}`}
        className={cn(
          "min-h-target hover:bg-surface-muted border-border flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border px-3 py-2",
          pending && "bg-surface-muted text-text-muted border-dashed",
        )}
      >
        {showKind ? (
          <span
            className={cn(
              "w-24 flex-none text-sm font-bold uppercase",
              line === "arrival" ? "text-success-text" : "text-text-muted",
            )}
          >
            {line === "arrival" ? t("comes") : t("leaves")}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-base font-semibold">{name}</span>
          <span className="text-text-muted text-sm">
            {line === "arrival" ? t("arrivalLine", { people, nights }) : t("departureLine", { nights })}
          </span>
          {pending ? <span className="text-warning-text text-sm font-semibold">{t("pendingLabel")}</span> : null}
          {line === "arrival"
            ? noteLines.map((text, i) => (
                <span key={i} className="text-sm flex items-start gap-1.5 break-words whitespace-pre-wrap">
                  <StickyNote size={16} aria-hidden="true" className="mt-0.5 flex-none" />
                  {text}
                </span>
              ))
            : null}
        </span>
        {stay.room ? (
          <ApartmentChip name={stay.room.name} color={stay.room.color ?? "#5B5852"} />
        ) : (
          <span className="bg-warning-soft text-warning-text rounded-pill px-3 py-1 text-sm font-semibold">
            {t("needsApartment")}
          </span>
        )}
      </Link>
    </li>
  );
}

/** Today's arrivals and departures in one list, each line saying which it is. */
function DayList({ arrivals, departures }: { arrivals: TodayStay[]; departures: TodayStay[] }) {
  const t = useTranslations("today");
  return (
    <ul className="flex flex-col gap-2">
      {arrivals.length === 0 ? (
        <li className="text-text-muted text-base">{t("noArrivals")}</li>
      ) : (
        arrivals.map((stay) => <StayRow key={stay.id} stay={stay} line="arrival" showKind />)
      )}
      {departures.length === 0 ? (
        <li className="text-text-muted text-base">{t("noDepartures")}</li>
      ) : (
        departures.map((stay) => <StayRow key={stay.id} stay={stay} line="departure" showKind />)
      )}
    </ul>
  );
}

/** Opens the printable arrival cards for these stays. Nothing when there are none. */
function PrintCardsLink({ stays }: { stays: TodayStay[] }) {
  const t = useTranslations("today");
  if (stays.length === 0) return null;
  return (
    <Link
      href={arrivalCardsHref(stays.map((s) => s.id))}
      className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg, "self-start")}
    >
      <Printer size={24} aria-hidden="true" />
      {t("printCards")}
    </Link>
  );
}

/** The coming days with arrivals or departures; quiet days are left out. */
function NextDays({ tomorrow }: { tomorrow: IsoDate }) {
  const t = useTranslations("today");
  const locale = useLocale() as UiLocale;
  const trpc = useTRPC();
  const errorText = useErrorText();
  const week = useQuery({
    ...trpc.today.week.queryOptions({ day: tomorrow, startOnDay: true }),
    refetchInterval: 60_000,
  });
  const days = week.data?.days.filter((d) => d.arrivals.length + d.departures.length > 0) ?? [];
  return (
    <Card
      title={t("nextDays")}
      aria-label={t("nextDays")}
      actions={
        <Link href="/app/week" className={cn(buttonBase, buttonVariants.secondary, buttonSizes.md)}>
          <Printer size={20} aria-hidden="true" />
          {t("printWeek")}
        </Link>
      }
    >
      {week.error ? (
        <ErrorState message={errorText(week.error)} onRetry={() => void week.refetch()} />
      ) : !week.data ? (
        <Skeleton variant="block" className="h-32" />
      ) : days.length === 0 ? (
        <p className="text-text-muted text-base">{t("nextDaysEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {days.map((day) => (
            <li key={day.date} className="flex flex-col gap-2">
              <h4 className="text-base font-semibold">
                {day.date === tomorrow ? t("tomorrow") : formatDay(day.date, locale)}
              </h4>
              <ul className="flex flex-col gap-2">
                {day.arrivals.map((stay) => (
                  <StayRow key={`a${stay.id}`} stay={stay} line="arrival" showKind />
                ))}
                {day.departures.map((stay) => (
                  <StayRow key={`d${stay.id}`} stay={stay} line="departure" showKind />
                ))}
              </ul>
              {day.date === tomorrow ? <PrintCardsLink stays={day.arrivals} /> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One quiet line per single empty night, linking to the calendar. */
function GapNights({ gaps }: { gaps: TodayGap[] }) {
  const t = useTranslations("today");
  const locale = useLocale() as UiLocale;
  if (gaps.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label={t("gapsLabel")}>
      {gaps.map((gap) => (
        <li key={`${gap.room.id}:${gap.start}`}>
          <Link
            href={gap.bookingId ? `/app/calendar?booking=${gap.bookingId}` : "/app/calendar"}
            className="text-text-muted text-sm hover:underline"
          >
            {t("gapLine", { count: gap.nights, date: formatDay(gap.start, locale), room: gap.room.name })}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Loading() {
  const t = useTranslations("today");
  return (
    <div role="status" aria-label={t("loading")} className="flex flex-col gap-6">
      <Skeleton variant="block" className="h-48" />
      <Skeleton variant="block" className="h-64" />
    </div>
  );
}

function Summary({ data }: { data: TodaySummary }) {
  const t = useTranslations("today");
  const needs = data.needsApartment;
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {needs > 0 ? (
        <Card
          title={
            <span className="flex items-center gap-2">
              <CircleAlert size={24} aria-hidden="true" />
              {t("needsTitle", { count: needs })}
            </span>
          }
          aria-label={t("needs")}
          className="ring-warning ring-2"
        >
          <Link href="/app/calendar" className={cn(buttonBase, buttonVariants.primary, buttonSizes.lg, "self-start")}>
            <CalendarDays size={24} aria-hidden="true" />
            {t("placeThem")}
          </Link>
        </Card>
      ) : null}

      <Card title={t("todayCard")} aria-label={t("todayCard")}>
        <DayList arrivals={data.arrivals} departures={data.departures} />
        <PrintCardsLink stays={data.arrivals} />
      </Card>

      <NextDays tomorrow={data.tomorrow} />

      <GapNights gaps={data.gaps} />
    </div>
  );
}

/** The Today screen: what needs an apartment, who arrives and leaves today, and the coming days. */
export function TodayScreen() {
  const t = useTranslations("today");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const summary = useQuery({ ...trpc.today.summary.queryOptions(), refetchInterval: 60_000 });

  return (
    <div className="flex flex-col gap-6 p-8 max-[759px]:p-4">
      <PageHeader
        title={t("title")}
        subtitle={summary.data ? <DateText date={summary.data.today} withYear /> : undefined}
      />
      {summary.data ? (
        <Summary data={summary.data} />
      ) : summary.error ? (
        <ErrorState message={errorText(summary.error)} onRetry={() => void summary.refetch()} />
      ) : (
        <Loading />
      )}
    </div>
  );
}

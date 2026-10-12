"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CalendarRange, CircleAlert, LogIn, LogOut, Printer, StickyNote, Sunrise } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { GAP_LOOKAHEAD_DAYS } from "@stay-ops/domain";
import { useTranslations } from "next-intl";
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
import { Skeleton } from "@/ui/Skeleton";
import { SearchLink, WeekLink } from "../search/QuickLinks";
import { SyncIndicator } from "../shell/SyncIndicator";

/** Which line goes under the guest's name. */
type Line = "arrival" | "departure";

function StayRow({ stay, line }: { stay: TodayStay; line: Line }) {
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
          "min-h-target hover:bg-surface-muted border-border flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-sm border px-3 py-2",
          pending && "bg-surface-muted text-text-muted border-dashed",
        )}
      >
        <span className="flex min-w-0 flex-col">
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

function StayList({ stays, line, empty }: { stays: TodayStay[]; line: Line; empty: string }) {
  if (stays.length === 0) return <p className="text-text-muted text-base">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {stays.map((stay) => (
        <StayRow key={stay.id} stay={stay} line={line} />
      ))}
    </ul>
  );
}

function CardTitle({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <span className="flex items-center gap-2">
      <Icon size={24} aria-hidden="true" />
      {children}
    </span>
  );
}

function CalendarLink({ primary, children }: { primary?: boolean; children: string }) {
  return (
    <Link
      href="/app/calendar"
      className={cn(
        buttonBase,
        buttonVariants[primary ? "primary" : "secondary"],
        buttonSizes.lg,
        "mt-auto self-start",
      )}
    >
      <CalendarDays size={24} aria-hidden="true" />
      {children}
    </Link>
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

/** "Κενές νύχτες": single empty nights between stays in the coming weeks. */
function GapNights({ gaps, days }: { gaps: TodayGap[]; days: number }) {
  const t = useTranslations("gapNights");
  return (
    <Card
      title={<CardTitle icon={CalendarRange}>{t("title")}</CardTitle>}
      aria-label={t("title")}
      className={cn(gaps.length > 0 && "ring-warning ring-2")}
    >
      {gaps.length === 0 ? (
        <p className="text-text-muted text-base">{t("none", { days })}</p>
      ) : (
        <>
          <p className="text-text-muted text-sm">{t("intro", { days })}</p>
          <ul className="flex flex-col gap-2">
            {gaps.map((gap) => (
              <li key={`${gap.room.id}:${gap.start}`}>
                <Link
                  href={gap.bookingId ? `/app/calendar?booking=${gap.bookingId}` : "/app/calendar"}
                  className="min-h-target hover:bg-surface-muted border-border flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-sm border px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-base font-semibold">
                      <DateText date={gap.start} to={gap.end} />
                    </span>
                    <span className="text-warning-text text-sm font-semibold">{t("label", { count: gap.nights })}</span>
                  </span>
                  <ApartmentChip name={gap.room.name} color={gap.room.color ?? "#5B5852"} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Loading() {
  const t = useTranslations("today");
  return (
    <div role="status" aria-label={t("loading")} className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-6 max-[1099px]:grid-cols-1">
        <Skeleton variant="block" className="h-64" />
        <Skeleton variant="block" className="h-64" />
        <Skeleton variant="block" className="h-64" />
      </div>
      <Skeleton variant="block" />
    </div>
  );
}

function Summary({ data }: { data: TodaySummary }) {
  const t = useTranslations("today");
  const needs = data.needsApartment;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 items-stretch gap-6 max-[1099px]:grid-cols-1">
        <Card title={<CardTitle icon={LogIn}>{t("arrivals")}</CardTitle>} aria-label={t("arrivals")}>
          <p className="text-3xl font-bold">{data.arrivals.length}</p>
          <StayList stays={data.arrivals} line="arrival" empty={t("noArrivals")} />
          <PrintCardsLink stays={data.arrivals} />
          <CalendarLink>{t("toCalendar")}</CalendarLink>
        </Card>
        <Card title={<CardTitle icon={LogOut}>{t("departures")}</CardTitle>} aria-label={t("departures")}>
          <p className="text-3xl font-bold">{data.departures.length}</p>
          <StayList stays={data.departures} line="departure" empty={t("noDepartures")} />
          <CalendarLink>{t("toCalendar")}</CalendarLink>
        </Card>
        <Card
          title={<CardTitle icon={CircleAlert}>{t("needs")}</CardTitle>}
          aria-label={t("needs")}
          className={cn(needs > 0 && "ring-warning ring-2")}
        >
          <p className="text-3xl font-bold">{needs}</p>
          <p className="text-base">{needs > 0 ? t("needsSentence", { count: needs }) : t("allPlaced")}</p>
          {needs > 0 ? <CalendarLink primary>{t("placeThem")}</CalendarLink> : null}
        </Card>
      </div>

      <Card title={<CardTitle icon={Sunrise}>{t("tomorrow")}</CardTitle>} aria-label={t("tomorrow")}>
        <div className="grid grid-cols-2 gap-6 max-[1099px]:grid-cols-1">
          <div className="flex flex-col gap-3">
            <h4 className="text-base font-semibold">
              {t("tomorrowArrivals")} ({data.tomorrowArrivals.length})
            </h4>
            <StayList stays={data.tomorrowArrivals} line="arrival" empty={t("noTomorrowArrivals")} />
            <PrintCardsLink stays={data.tomorrowArrivals} />
          </div>
          <div className="flex flex-col gap-3">
            <h4 className="text-base font-semibold">
              {t("tomorrowDepartures")} ({data.tomorrowDepartures.length})
            </h4>
            <StayList stays={data.tomorrowDepartures} line="departure" empty={t("noTomorrowDepartures")} />
          </div>
        </div>
      </Card>

      <GapNights gaps={data.gaps} days={GAP_LOOKAHEAD_DAYS} />

      <p className="text-text-muted text-sm">
        <SyncIndicator />
      </p>
    </div>
  );
}

/** The Today screen: who arrives and leaves today and tomorrow, and what still needs an apartment. */
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
        actions={
          <>
            <SearchLink />
            <WeekLink />
          </>
        }
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

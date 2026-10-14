"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BedDouble,
  CalendarRange,
  ChartColumn,
  ChevronDown,
  Clock,
  History,
  Network,
  Trophy,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { IsoDate, MonthStats, YearStats } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { StatisticsData } from "@/api/types";
import { compactSelectClass } from "@/ui/field";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Card } from "@/ui/Card";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { formatDay, formatMoney, type UiLocale } from "@/ui/format";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { Delta } from "./Delta";
import { OccupancyCard } from "./OccupancyCard";
import { ReviewsCard } from "./ReviewsCard";

export type StatisticsScreenProps = {
  /** Today in the business time zone, from the server. */
  today: IsoDate;
};

const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : null);

function useFormat() {
  const locale = useLocale() as UiLocale;
  const number = (value: number, digits = 0) =>
    new Intl.NumberFormat(locale === "el" ? "el-GR" : "en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  return { locale, number, money: (cents: number) => formatMoney(cents, locale) };
}

function CardTitle({ icon: Icon, children }: { icon: typeof BedDouble; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <Icon size={24} aria-hidden="true" />
      {children}
    </span>
  );
}

function Tile({
  label,
  value,
  before,
  delta,
  hint,
}: {
  label: string;
  value: string;
  before: string;
  delta: ReactNode;
  hint?: string | undefined;
}) {
  const t = useTranslations("stats");
  return (
    <div className="rounded-card shadow-card bg-surface text-text flex flex-col gap-1 p-5">
      <span className="text-base font-semibold">{label}</span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        {delta}
        <span className="text-text-muted text-sm">{t("lastYearWas", { value: before })}</span>
      </span>
      {hint ? <span className="text-text-muted text-sm">{hint}</span> : null}
    </div>
  );
}

function Headlines({ now, before, leadTimeKnown }: { now: YearStats; before: YearStats; leadTimeKnown: number }) {
  const t = useTranslations("stats.kpi");
  const { number, money } = useFormat();
  const dash = t("none");
  const orDash = (v: number | null, f: (n: number) => string) => (v === null ? dash : f(v));
  const pct = (v: number | null) => orDash(v, (n) => t("percentValue", { value: n }));
  const days = (v: number | null) => orDash(v, (n) => t("daysValue", { value: number(n, 1) }));
  const tiles = [
    {
      label: t("income"),
      value: money(now.incomeCents),
      before: money(before.incomeCents),
      delta: <Delta now={now.incomeCents} before={before.incomeCents} />,
    },
    {
      label: t("payout"),
      value: money(now.payoutCents),
      before: money(before.payoutCents),
      delta: <Delta now={now.payoutCents} before={before.payoutCents} />,
      hint: t("fees", { amount: money(now.feeCents) }),
    },
    {
      label: t("bookings"),
      value: number(now.bookings),
      before: number(before.bookings),
      delta: <Delta now={now.bookings} before={before.bookings} />,
    },
    {
      label: t("nights"),
      value: number(now.nights),
      before: number(before.nights),
      delta: <Delta now={now.nights} before={before.nights} />,
    },
    {
      label: t("occupancy"),
      value: pct(now.occupancyPercent),
      before: pct(before.occupancyPercent),
      delta: <Delta now={now.occupancyPercent} before={before.occupancyPercent} kind="points" />,
    },
    {
      label: t("averageNight"),
      value: orDash(now.averageNightCents, money),
      before: orDash(before.averageNightCents, money),
      delta: <Delta now={now.averageNightCents} before={before.averageNightCents} />,
    },
    {
      label: t("perAvailableNight"),
      value: orDash(now.incomePerAvailableNightCents, money),
      before: orDash(before.incomePerAvailableNightCents, money),
      delta: <Delta now={now.incomePerAvailableNightCents} before={before.incomePerAvailableNightCents} />,
      hint: t("perAvailableNightHint"),
    },
    {
      label: t("averageStay"),
      value: orDash(now.averageStayNights, (n) => t("nightsValue", { value: number(n, 1) })),
      before: orDash(before.averageStayNights, (n) => t("nightsValue", { value: number(n, 1) })),
      delta: <Delta now={now.averageStayNights} before={before.averageStayNights} kind="number" />,
    },
    {
      label: t("leadTime"),
      value: days(now.averageLeadDays),
      before: days(before.averageLeadDays),
      delta: <Delta now={now.averageLeadDays} before={before.averageLeadDays} kind="number" />,
      hint: leadTimeKnown < 100 ? t("leadTimeKnown", { value: leadTimeKnown }) : undefined,
    },
    {
      label: t("guests"),
      value: number(now.adults + now.children),
      before: number(before.adults + before.children),
      delta: <Delta now={now.adults + now.children} before={before.adults + before.children} />,
      hint: t("guestsHint", {
        adults: now.adults,
        children: now.children,
        infants: now.infants,
        average: now.averageGuests === null ? dash : number(now.averageGuests, 1),
      }),
    },
    {
      label: t("returning"),
      value: number(now.returningStays),
      before: number(before.returningStays),
      delta: <Delta now={now.returningStays} before={before.returningStays} kind="number" />,
      hint: t("returningHint", { guests: now.distinctGuests }),
    },
    {
      label: t("cancellations"),
      value: number(now.cancellations),
      before: number(before.cancellations),
      delta: <Delta now={now.cancellations} before={before.cancellations} kind="number" lowerIsBetter />,
      hint: t("cancellationsHint", {
        percent: now.cancellationPercent ?? 0,
        paid: money(now.cancelledIncomeCents),
      }),
    },
  ];
  return (
    <div className="grid grid-cols-4 gap-4 narrow:grid-cols-3 phone:grid-cols-2 small:grid-cols-1">
      {tiles.map((tile) => (
        <Tile key={tile.label} {...tile} />
      ))}
    </div>
  );
}

type MonthMetric = "income" | "nights" | "occupancy" | "bookings";

function monthValue(m: MonthStats, metric: MonthMetric): number {
  if (metric === "income") return m.incomeCents;
  if (metric === "nights") return m.nights;
  if (metric === "bookings") return m.bookings;
  return percentOf(m.placedNights, m.availableNights) ?? 0;
}

function MonthCompare({ data }: { data: StatisticsData }) {
  const t = useTranslations();
  const { number, money } = useFormat();
  const [metric, setMetric] = useState<MonthMetric>("income");
  const show = (v: number) =>
    metric === "income" ? money(v) : metric === "occupancy" ? t("stats.kpi.percentValue", { value: v }) : number(v);
  const rows = data.thisYear.byMonth.map((m, i) => ({
    month: m.month,
    now: monthValue(m, metric),
    before: monthValue(data.lastYear.byMonth[i]!, metric),
  }));
  const max = Math.max(1, ...rows.flatMap((r) => [r.now, r.before]));
  const metrics: MonthMetric[] = ["income", "nights", "occupancy", "bookings"];
  return (
    <Card title={<CardTitle icon={ChartColumn}>{t("stats.months.title")}</CardTitle>}>
      <ChoiceGroup<MonthMetric>
        size="md"
        label={t("stats.months.metric")}
        value={metric}
        onChange={setMetric}
        choices={metrics.map((m) => ({ value: m, label: t(`stats.months.${m}`) }))}
      />
      <ul className="flex flex-wrap gap-2 text-sm" aria-hidden="true">
        <li className="border-border flex items-center gap-2 rounded-pill border px-3 py-1">
          <span className="bg-accent size-3 rounded-sm" />
          {data.year}
        </li>
        <li className="border-border flex items-center gap-2 rounded-pill border px-3 py-1">
          <span className="bg-text-muted size-3 rounded-sm opacity-50" />
          {data.year - 1}
        </li>
      </ul>
      <div
        role="list"
        aria-label={t("stats.months.chartLabel", { metric: t(`stats.months.${metric}`) })}
        className="grid grid-cols-12 gap-2 phone:grid-cols-1 phone:gap-1"
      >
        {rows.map((r) => (
          <div
            key={r.month}
            role="listitem"
            aria-label={t("stats.months.itemLabel", {
              month: t("common.month", { month: r.month }),
              now: show(r.now),
              before: show(r.before),
              year: data.year,
              lastYear: data.year - 1,
            })}
            className="flex min-w-0 flex-col items-center gap-1 phone:flex-row phone:gap-3"
          >
            <span className="text-xs font-semibold whitespace-nowrap tabular-nums phone:order-3 phone:w-24 phone:text-right">
              {show(r.now)}
            </span>
            <div className="flex h-40 w-full items-end justify-center gap-1 phone:order-2 phone:h-auto phone:flex-1 phone:flex-col phone:items-start">
              <span
                className="bg-accent block h-(--bar) w-2/5 max-w-6 rounded-t-xs phone:h-2.5 phone:w-(--bar) phone:max-w-none phone:rounded-t-none phone:rounded-r-xs"
                style={{ "--bar": `${(r.now / max) * 100}%` } as CSSProperties}
              />
              <span
                className="bg-text-muted block h-(--bar) w-2/5 max-w-6 rounded-t-xs opacity-50 phone:h-2.5 phone:w-(--bar) phone:max-w-none phone:rounded-t-none phone:rounded-r-xs"
                style={{ "--bar": `${(r.before / max) * 100}%` } as CSSProperties}
              />
            </div>
            <span className="text-sm font-medium phone:order-1 phone:w-24">
              {t("income.monthShort", { month: r.month })}
            </span>
          </div>
        ))}
      </div>
      <p className="text-text-muted text-sm">{t("stats.months.note")}</p>
    </Card>
  );
}

const cell = "px-3 py-3 text-right tabular-nums whitespace-nowrap align-top";
const head = "px-3 py-3 text-right font-bold whitespace-nowrap";

function ChannelTable({ data }: { data: StatisticsData }) {
  const t = useTranslations();
  const { number, money } = useFormat();
  const total = data.thisYear.incomeCents;
  return (
    <Card title={<CardTitle icon={Network}>{t("stats.channels.title")}</CardTitle>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-base">
          <thead>
            <tr className="border-text-muted border-b-2">
              <th scope="col" className="px-3 py-3 text-left font-bold">
                {t("stats.channels.channel")}
              </th>
              <th scope="col" className={head}>
                {t("stats.kpi.bookings")}
              </th>
              <th scope="col" className={head}>
                {t("stats.kpi.nights")}
              </th>
              <th scope="col" className={head}>
                {t("stats.kpi.income")}
              </th>
              <th scope="col" className={head}>
                {t("stats.channels.share")}
              </th>
              <th scope="col" className={head}>
                {t("stats.channels.fees")}
              </th>
              <th scope="col" className={head}>
                {t("stats.kpi.cancellations")}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.thisYear.byChannel.map((c, i) => {
              const before = data.lastYear.byChannel[i]!;
              return (
                <tr key={c.channel} className="border-border border-b">
                  <th scope="row" className="px-3 py-3 text-left font-semibold">
                    {t(`channel.${c.channel}`)}
                  </th>
                  <td className={cell}>
                    <span className="block">{number(c.bookings)}</span>
                    <Delta now={c.bookings} before={before.bookings} />
                  </td>
                  <td className={cell}>
                    <span className="block">{number(c.nights)}</span>
                    <Delta now={c.nights} before={before.nights} />
                  </td>
                  <td className={cell}>
                    <span className="block font-semibold">{money(c.incomeCents)}</span>
                    <Delta now={c.incomeCents} before={before.incomeCents} />
                  </td>
                  <td className={cell}>
                    {t("stats.kpi.percentValue", { value: percentOf(c.incomeCents, total) ?? 0 })}
                  </td>
                  <td className={cell}>{money(c.feeCents)}</td>
                  <td className={cell}>{number(c.cancellations)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ApartmentTable({ data }: { data: StatisticsData }) {
  const t = useTranslations();
  const { number, money } = useFormat();
  if (data.apartments.length === 0) return null;
  return (
    <Card title={<CardTitle icon={BedDouble}>{t("stats.apartments.title")}</CardTitle>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-base">
          <thead>
            <tr className="border-text-muted border-b-2">
              <th scope="col" className="bg-surface sticky left-0 px-3 py-3 text-left font-bold">
                {t("stats.apartments.apartment")}
              </th>
              <th scope="col" className={head}>
                {t("stats.kpi.bookings")}
              </th>
              <th scope="col" className={head}>
                {t("stats.kpi.nights")}
              </th>
              <th scope="col" className={head}>
                {t("stats.kpi.occupancy")}
              </th>
              <th scope="col" className={head}>
                {t("stats.apartments.income")}
              </th>
              <th scope="col" className={head}>
                {t("stats.kpi.averageNight")}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.apartments.map((a, i) => {
              const now = data.thisYear.byRoom[i]!;
              const before = data.lastYear.byRoom[i]!;
              const occ = (r: typeof now) => percentOf(r.nights, r.availableNights);
              const avg = (r: typeof now) => (r.nights > 0 ? Math.round(r.incomeCents / r.nights) : null);
              return (
                <tr key={a.id} className="border-border border-b">
                  <th scope="row" className="bg-surface sticky left-0 px-3 py-3 text-left align-top">
                    <ApartmentChip name={a.name} color={a.color} />
                  </th>
                  <td className={cell}>
                    <span className="block">{number(now.bookings)}</span>
                    <Delta now={now.bookings} before={before.bookings} />
                  </td>
                  <td className={cell}>
                    <span className="block">{number(now.nights)}</span>
                    <Delta now={now.nights} before={before.nights} />
                  </td>
                  <td className={cell}>
                    <span className="block font-semibold">
                      {occ(now) === null ? t("stats.kpi.none") : t("stats.kpi.percentValue", { value: occ(now)! })}
                    </span>
                    <Delta now={occ(now)} before={occ(before)} kind="points" />
                  </td>
                  <td className={cell}>
                    <span className="block font-semibold">{money(now.incomeCents)}</span>
                    <Delta now={now.incomeCents} before={before.incomeCents} />
                  </td>
                  <td className={cell}>
                    <span className="block">{avg(now) === null ? t("stats.kpi.none") : money(avg(now)!)}</span>
                    <Delta now={avg(now)} before={avg(before)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-text-muted text-sm">{t("stats.apartments.note")}</p>
    </Card>
  );
}

/** Horizontal bars: this year in colour, last year in grey under it. */
function Distribution({
  title,
  labels,
  now,
  before,
  year,
}: {
  title: string;
  labels: string[];
  now: readonly number[];
  before: readonly number[];
  year: number;
}) {
  const t = useTranslations("stats");
  const max = Math.max(1, ...now, ...before);
  const totalNow = now.reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-base font-semibold">{title}</h4>
      <ul className="flex flex-col gap-2">
        {labels.map((label, i) => (
          <li
            key={label}
            className="grid grid-cols-[8.5rem_1fr_4.5rem] items-center gap-2 text-sm"
            aria-label={t("distribution.itemLabel", {
              label,
              now: now[i] ?? 0,
              before: before[i] ?? 0,
              year,
              lastYear: year - 1,
            })}
          >
            <span className="font-medium">{label}</span>
            <span className="flex flex-col gap-1" aria-hidden="true">
              <span
                className="bg-accent block h-3 w-(--bar) min-w-0.5 rounded-r-xs"
                style={{ "--bar": `${((now[i] ?? 0) / max) * 100}%` } as CSSProperties}
              />
              <span
                className="bg-text-muted block h-2 w-(--bar) min-w-0.5 rounded-r-xs opacity-50"
                style={{ "--bar": `${((before[i] ?? 0) / max) * 100}%` } as CSSProperties}
              />
            </span>
            <span className="text-right tabular-nums" aria-hidden="true">
              <span className="font-semibold">{now[i] ?? 0}</span>{" "}
              <span className="text-text-muted">
                ({totalNow > 0 ? Math.round(((now[i] ?? 0) * 100) / totalNow) : 0}%)
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Patterns({ data }: { data: StatisticsData }) {
  const t = useTranslations();
  const now = data.thisYear;
  const before = data.lastYear;
  return (
    <Card title={<CardTitle icon={Clock}>{t("stats.patterns.title")}</CardTitle>}>
      <p className="text-text-muted text-sm">
        {t("stats.patterns.legend", { year: data.year, lastYear: data.year - 1 })}
      </p>
      <div className="grid grid-cols-2 gap-8 phone:grid-cols-1">
        <Distribution
          title={t("stats.patterns.stayLength")}
          labels={[0, 1, 2, 3, 4, 5].map((i) => t("stats.patterns.stayBucket", { bucket: i }))}
          now={now.stayLength}
          before={before.stayLength}
          year={data.year}
        />
        <Distribution
          title={t("stats.patterns.leadTime")}
          labels={[0, 1, 2, 3, 4].map((i) => t("stats.patterns.leadBucket", { bucket: i }))}
          now={now.leadTime}
          before={before.leadTime}
          year={data.year}
        />
        <Distribution
          title={t("stats.patterns.partySize")}
          labels={[0, 1, 2, 3, 4].map((i) => t("stats.patterns.partyBucket", { bucket: i }))}
          now={now.partySize}
          before={before.partySize}
          year={data.year}
        />
        <Distribution
          title={t("stats.patterns.weekday")}
          labels={[1, 2, 3, 4, 5, 6, 0].map((day) => t("common.weekdayShort", { day }))}
          now={now.checkinWeekday}
          before={before.checkinWeekday}
          year={data.year}
        />
      </div>
    </Card>
  );
}

function Records({ data }: { data: StatisticsData }) {
  const t = useTranslations();
  const { number, money } = useFormat();
  const best = (rows: readonly MonthStats[], pick: (m: MonthStats) => number) =>
    rows.reduce<MonthStats | null>((top, m) => (pick(m) > 0 && (!top || pick(m) > pick(top)) ? m : top), null);
  const busiest = best(data.thisYear.byMonth, (m) => m.nights);
  const richest = best(data.thisYear.byMonth, (m) => m.incomeCents);
  const items = [
    {
      label: t("stats.records.busiestMonth"),
      value: busiest
        ? t("stats.records.monthNights", {
            month: t("common.month", { month: busiest.month }),
            nights: number(busiest.nights),
          })
        : t("stats.kpi.none"),
    },
    {
      label: t("stats.records.bestMonth"),
      value: richest
        ? `${t("common.month", { month: richest.month })} · ${money(richest.incomeCents)}`
        : t("stats.kpi.none"),
    },
    {
      label: t("stats.records.longestStay"),
      value:
        data.thisYear.longestStayNights > 0
          ? t("common.nights", { count: data.thisYear.longestStayNights })
          : t("stats.kpi.none"),
    },
    {
      label: t("stats.records.biggestBooking"),
      value: data.thisYear.biggestBookingCents > 0 ? money(data.thisYear.biggestBookingCents) : t("stats.kpi.none"),
    },
    { label: t("stats.records.pending"), value: number(data.thisYear.pending) },
  ];
  return (
    <Card title={<CardTitle icon={Trophy}>{t("stats.records.title")}</CardTitle>}>
      <dl className="grid grid-cols-5 gap-4 narrow:grid-cols-3 phone:grid-cols-1">
        {items.map((i) => (
          <div key={i.label} className="border-border rounded-card flex flex-col gap-1 border p-4">
            <dt className="text-text-muted text-sm font-medium">{i.label}</dt>
            <dd className="text-lg font-bold">{i.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function YearsTable({ data }: { data: StatisticsData }) {
  const t = useTranslations("stats");
  const { number, money } = useFormat();
  if (data.years.length < 2) return null;
  return (
    <Card title={<CardTitle icon={History}>{t("years.title")}</CardTitle>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-base">
          <thead>
            <tr className="border-text-muted border-b-2">
              <th scope="col" className="px-3 py-3 text-left font-bold">
                {t("years.year")}
              </th>
              <th scope="col" className={head}>
                {t("kpi.income")}
              </th>
              <th scope="col" className={head}>
                {t("kpi.bookings")}
              </th>
              <th scope="col" className={head}>
                {t("kpi.nights")}
              </th>
              <th scope="col" className={head}>
                {t("kpi.occupancy")}
              </th>
              <th scope="col" className={head}>
                {t("kpi.averageNight")}
              </th>
              <th scope="col" className={head}>
                {t("kpi.cancellations")}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.years.map((y, i) => {
              const prev = data.years[i - 1];
              return (
                <tr key={y.year} className={cn("border-border border-b", y.year === data.year && "bg-accent-soft")}>
                  <th scope="row" className="px-3 py-3 text-left font-semibold">
                    {y.year}
                  </th>
                  <td className={cell}>
                    <span className="block font-semibold">{money(y.incomeCents)}</span>
                    {prev && prev.year === y.year - 1 ? <Delta now={y.incomeCents} before={prev.incomeCents} /> : null}
                  </td>
                  <td className={cell}>{number(y.bookings)}</td>
                  <td className={cell}>{number(y.nights)}</td>
                  <td className={cell}>
                    {y.occupancyPercent === null ? t("kpi.none") : t("kpi.percentValue", { value: y.occupancyPercent })}
                  </td>
                  <td className={cell}>{y.averageNightCents === null ? t("kpi.none") : money(y.averageNightCents)}</td>
                  <td className={cell}>{number(y.cancellations)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-text-muted text-sm">{t("years.note")}</p>
    </Card>
  );
}

function StatisticsBody({ data }: { data: StatisticsData }) {
  const t = useTranslations("stats");
  const { locale } = useFormat();
  return (
    <>
      <p className="text-text-muted flex items-start gap-2">
        <CalendarRange size={20} className="mt-1 shrink-0" aria-hidden="true" />
        {data.through
          ? t("periodToDate", { day: formatDay(data.through, locale), year: data.year, lastYear: data.year - 1 })
          : t("periodWhole", { year: data.year, lastYear: data.year - 1 })}
      </p>
      <Headlines now={data.thisYear} before={data.lastYear} leadTimeKnown={data.leadTimeKnown} />
      <MonthCompare data={data} />
      <ChannelTable data={data} />
      <ApartmentTable data={data} />
      <Patterns data={data} />
      <Records data={data} />
      <YearsTable data={data} />
      <p className="text-text-muted flex items-start gap-2 text-sm">
        <Users size={20} className="mt-1 shrink-0" aria-hidden="true" />
        {t("rules")}
      </p>
    </>
  );
}

/** Στατιστικά: every figure for a year against the one before, plus review scores. */
export function StatisticsScreen({ today }: StatisticsScreenProps) {
  const t = useTranslations("stats");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [toDate, setToDate] = useState(true);
  const cut = year === currentYear && toDate;
  const query = useQuery({
    ...trpc.stats.year.queryOptions({ year, toDate: cut }),
    placeholderData: (prev) => prev,
  });
  const years = (query.data?.years ?? []).map((y) => y.year);
  const choices = [...new Set([...years, currentYear, year])].sort((a, b) => b - a);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 phone:p-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {year === currentYear ? (
              <ChoiceGroup<`${boolean}`>
                size="md"
                label={t("periodLabel")}
                value={`${toDate}`}
                onChange={(v) => setToDate(v === `${true}`)}
                choices={[true, false].map((v) => ({
                  value: `${v}` as const,
                  label: v ? t("toDate") : t("wholeYear"),
                }))}
              />
            ) : null}
            <label className="flex items-center gap-3 text-base font-medium">
              {t("year")}
              <span className="relative">
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={compactSelectClass}>
                  {choices.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={20}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
                />
              </span>
            </label>
          </>
        }
      />
      {query.error && !query.data ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton variant="block" className="h-40" />
          <Skeleton variant="block" className="h-72" />
        </div>
      ) : (
        <StatisticsBody data={query.data} />
      )}
      <OccupancyCard year={year} />
      <ReviewsCard year={year} today={today} />
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  averageNightCents,
  occupancyChange,
  occupancyPercent,
  occupancyTotal,
  type MonthOccupancy,
  type RoomOccupancy,
} from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { formatMoney } from "@/ui/format";
import { Skeleton } from "@/ui/Skeleton";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function Cell({
  now,
  before,
  strong = false,
}: {
  now: MonthOccupancy;
  before: MonthOccupancy | undefined;
  strong?: boolean;
}) {
  const t = useTranslations("stats.occupancy");
  const locale = useLocale();
  const price = averageNightCents(now);
  const change = before ? occupancyChange(now, before) : 0;
  const percent = t("percent", { value: occupancyPercent(now) });
  const priceText = price === null ? t("none") : formatMoney(price, locale);
  const arrow = change > 0 ? "▲" : "▼";
  const changeText = t("points", { points: Math.abs(change) });
  const changeSpoken = change > 0 ? t("up", { points: change }) : t("down", { points: Math.abs(change) });
  return (
    <td className="px-3 py-2 text-right align-top whitespace-nowrap tabular-nums">
      <span className={cn("block text-base", strong ? "font-bold" : "font-semibold")}>{percent}</span>
      <span className="text-text-muted block text-sm">{priceText}</span>
      {change !== 0 ? (
        <span className={cn("block text-sm font-semibold", change > 0 ? "text-success-text" : "text-danger")}>
          <span aria-hidden="true">
            {arrow} {changeText}
          </span>
          <span className="sr-only">{changeSpoken}</span>
        </span>
      ) : null}
    </td>
  );
}

function OccupancyTable({
  apartments,
  thisYear,
  lastYear,
}: {
  apartments: readonly { id: string; name: string; color: string | null }[];
  thisYear: readonly RoomOccupancy[];
  lastYear: readonly RoomOccupancy[];
}) {
  const t = useTranslations();
  const head = "px-3 py-3 text-right font-bold whitespace-nowrap";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-base">
        <thead>
          <tr className="border-text-muted border-b-2">
            <th scope="col" className="bg-surface sticky left-0 px-3 py-3 text-left font-bold">
              {t("stats.occupancy.colApartment")}
            </th>
            {MONTHS.map((m) => (
              <th key={m} scope="col" className={head}>
                {t("income.monthShort", { month: m })}
              </th>
            ))}
            <th scope="col" className={head}>
              {t("stats.occupancy.colTotal")}
            </th>
          </tr>
        </thead>
        <tbody>
          {apartments.map((a, i) => {
            const now = thisYear[i]?.months ?? [];
            const before = lastYear[i]?.months ?? [];
            return (
              <tr key={a.id} className="border-border border-b">
                <th scope="row" className="bg-surface sticky left-0 px-3 py-2 text-left align-top">
                  <ApartmentChip name={a.name} />
                </th>
                {now.map((month, m) => (
                  <Cell key={m} now={month} before={before[m]} />
                ))}
                <Cell now={occupancyTotal(now)} before={occupancyTotal(before)} strong />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Occupancy and average price per night, by apartment and month, against the year before. */
export function OccupancyCard({ year }: { year: number }) {
  const t = useTranslations("stats.occupancy");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const query = useQuery({ ...trpc.money.occupancy.queryOptions({ year }), placeholderData: (prev) => prev });
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <CalendarDays size={24} aria-hidden="true" />
          {t("title")}
        </span>
      }
    >
      <p className="text-text-muted">{t("note", { year })}</p>
      {query.error && !query.data ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <Skeleton variant="block" className="h-48" />
      ) : query.data.apartments.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <>
          <OccupancyTable
            apartments={query.data.apartments}
            thisYear={query.data.thisYear}
            lastYear={query.data.lastYear}
          />
          <p className="text-text-muted text-sm">{t("legend")}</p>
        </>
      )}
    </Card>
  );
}

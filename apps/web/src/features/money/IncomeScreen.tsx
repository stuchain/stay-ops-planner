"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BedDouble,
  ChartColumn,
  ChartNoAxesCombined,
  ChevronDown,
  Download,
  FileText,
  Table2,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { LedgerYearData } from "@/api/types";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { formatMoney } from "@/ui/format";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { incomeView, type IncomeView } from "./incomeView";
import { LedgerTable } from "./LedgerTable";
import { apartmentColor, MonthlyChart } from "./MonthlyChart";
import { OccupancyCard } from "./OccupancyCard";
import { EstimatePill, TaxCard } from "./TaxCard";

export type IncomeScreenProps = {
  /** Today in the business time zone, from the server. */
  today: IsoDate;
};

function StatTile({ label, value, hint, tone }: { label: React.ReactNode; value: string; hint: string; tone?: "tax" }) {
  return (
    <div
      className={cn(
        "rounded-card shadow-card flex flex-col gap-1 p-5",
        tone === "tax" ? "bg-warning-soft" : "bg-surface text-text",
      )}
    >
      <span className="flex items-center gap-2 text-base font-semibold">{label}</span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      <span className={cn("text-sm", tone === "tax" ? "text-warning-text" : "text-text-muted")}>{hint}</span>
    </div>
  );
}

function MonthTable({ ledger, view }: { ledger: LedgerYearData; view: IncomeView }) {
  const t = useTranslations();
  const locale = useLocale();
  const money = (cents: number) => formatMoney(cents, locale);
  const cell = "px-3 py-2.5 text-right tabular-nums whitespace-nowrap";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-base max-[759px]:text-sm">
        <thead>
          <tr className="border-text-muted border-b-2">
            <th scope="col" className="px-3 py-2.5 text-left font-bold">
              {t("income.colMonth")}
            </th>
            {ledger.apartments.map((a) => (
              <th key={a.index} scope="col" className="px-3 py-2.5 text-right font-bold whitespace-nowrap">
                <span
                  className="mr-1.5 inline-block size-3 rounded-sm align-[-1px]"
                  style={{ background: apartmentColor(a) }}
                  aria-hidden="true"
                />
                {a.label}
              </th>
            ))}
            <th scope="col" className="px-3 py-2.5 text-right font-bold">
              {t("income.colTotal")}
            </th>
          </tr>
        </thead>
        <tbody>
          {view.months.map((m) => (
            <tr
              key={m.month}
              className={cn(
                "border-border border-b",
                m.kind === "current" && "bg-accent-soft",
                m.kind === "expected" && "text-text-muted",
              )}
            >
              <th scope="row" className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                {t("common.month", { month: m.month })}{" "}
                {m.kind === "expected" ? <span className="text-text-muted">{t("income.monthExpected")}</span> : null}
                {m.kind === "current" ? (
                  <span className="bg-success-soft text-success-text rounded-full px-2 py-0.5 text-sm font-semibold">
                    {t("income.now")}
                  </span>
                ) : null}
              </th>
              {m.perApartment.map((v, i) => (
                <td key={i} className={cell}>
                  {money(v)}
                </td>
              ))}
              <td className={cn(cell, "font-bold")}>{money(m.totalCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-text-muted border-t-2 font-bold">
            <th scope="row" className="px-3 py-2.5 text-left">
              {t("income.yearTotal")}
            </th>
            {ledger.totals.byRentalCents.map((v, i) => (
              <td key={i} className={cell}>
                {money(v)}
              </td>
            ))}
            <td className={cell}>{money(ledger.totals.totalCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function IncomeBody({ ledger, today }: { ledger: LedgerYearData; today: IsoDate }) {
  const t = useTranslations();
  const locale = useLocale();
  const money = (cents: number) => formatMoney(cents, locale);
  const view = useMemo(() => incomeView(ledger, today), [ledger, today]);
  const [showDetails, setShowDetails] = useState(false);
  const past = ledger.year < Number(today.slice(0, 4));
  const future = view.futureMonths;
  const monthName = (m: number) => t("common.month", { month: m });

  return (
    <>
      <div className="grid grid-cols-3 gap-4 max-[1023px]:grid-cols-1">
        <StatTile
          label={t("income.soFar")}
          value={money(view.soFarCents)}
          hint={past ? t("income.soFarHintPast") : t("income.soFarHint")}
        />
        <StatTile label={t("income.expected")} value={money(view.expectedCents)} hint={t("income.expectedHint")} />
        <StatTile
          tone="tax"
          label={
            <>
              {t("income.tax")} <EstimatePill />
            </>
          }
          value={money(ledger.tax.taxCents)}
          hint={t("income.taxHint", { amount: money(ledger.totals.totalCents) })}
        />
      </div>

      {ledger.totals.unbucketedCount > 0 ? (
        <p role="status" className="bg-warning-soft text-warning-text rounded-card flex items-start gap-2 p-4">
          <TriangleAlert size={24} className="shrink-0" aria-hidden="true" />
          {t("income.unbucketed", {
            count: ledger.totals.unbucketedCount,
            amount: money(ledger.totals.unbucketedCents),
          })}
        </p>
      ) : null}

      <Card
        title={
          <span className="flex items-center gap-2">
            <BedDouble size={24} aria-hidden="true" />
            {t("income.perApartment", { year: ledger.year })}
          </span>
        }
      >
        <div className="grid grid-cols-4 gap-4 max-[1023px]:grid-cols-2 max-[479px]:grid-cols-1">
          {ledger.apartments.map((a, i) => (
            <div
              key={a.index}
              className="border-border rounded-card bg-surface flex flex-col gap-1 border border-t-[6px] p-4"
              style={{ borderTopColor: apartmentColor(a) }}
            >
              <span className="flex items-center gap-2 text-lg font-semibold">
                <span className="size-3 rounded-sm" style={{ background: apartmentColor(a) }} aria-hidden="true" />
                {a.label}
              </span>
              <span className="text-xl font-bold tabular-nums">{money(ledger.totals.byRentalCents[i] ?? 0)}</span>
            </div>
          ))}
        </div>
        <p className="text-text-muted">{t("income.perApartmentNote")}</p>
      </Card>

      <Card
        title={
          <span className="flex items-center gap-2">
            <ChartColumn size={24} aria-hidden="true" />
            {t("income.perMonth")}
          </span>
        }
      >
        <MonthlyChart year={ledger.year} months={view.months} apartments={ledger.apartments} />
        {future.length > 0 && ledger.totals.totalCents !== 0 ? (
          <p className="text-text-muted">
            {future.length > 1
              ? t("income.futureNote", { from: monthName(future[0]!), to: monthName(future[future.length - 1]!) })
              : t("income.futureNoteOne", { month: monthName(future[0]!) })}
          </p>
        ) : null}
      </Card>

      <OccupancyCard year={ledger.year} />

      <Card
        title={
          <span className="flex items-center gap-2">
            <Table2 size={24} aria-hidden="true" />
            {t("income.exactTitle")}
          </span>
        }
      >
        <MonthTable ledger={ledger} view={view} />
      </Card>

      <TaxCard ledger={ledger} />

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/api/money/export?year=${ledger.year}`}
          download
          className={cn(buttonBase, buttonVariants.primary, buttonSizes.lg)}
        >
          <Download size={24} aria-hidden="true" />
          {t("income.export")}
        </a>
        <Link
          href={`/app/excel/report?year=${ledger.year}`}
          className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg)}
        >
          <FileText size={24} aria-hidden="true" />
          {t("income.report")}
        </Link>
        <Link href="/app/stats" className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg)}>
          <ChartNoAxesCombined size={24} aria-hidden="true" />
          {t("income.statistics")}
        </Link>
        <button
          type="button"
          aria-expanded={showDetails}
          aria-controls="income-details"
          onClick={() => setShowDetails((v) => !v)}
          className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg)}
        >
          {t("income.details")}
          <ChevronDown
            size={24}
            aria-hidden="true"
            className={cn("transition-transform", showDetails && "rotate-180")}
          />
        </button>
      </div>

      {showDetails ? (
        <div id="income-details">
          <LedgerTable ledger={ledger} />
        </div>
      ) : null}
    </>
  );
}

/** Έσοδα: the year at a glance for the father, with the detailed ledger one click away. */
export function IncomeScreen({ today }: IncomeScreenProps) {
  const t = useTranslations();
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const query = useQuery({ ...trpc.money.year.queryOptions({ year }), placeholderData: (prev) => prev });
  const years = query.data?.years ?? [year];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 max-[759px]:p-4">
      <PageHeader
        title={t("income.title")}
        actions={
          <label className="flex items-center gap-3 text-base font-medium">
            {t("income.year")}
            <span className="relative">
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="border-border bg-surface min-h-target appearance-none rounded-sm border py-2 pr-10 pl-4 text-base font-semibold"
              >
                {years.map((y) => (
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
        }
      />
      {query.error && !query.data ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton variant="block" />
          <Skeleton variant="block" className="h-40" />
          <Skeleton variant="block" className="h-72" />
        </div>
      ) : (
        <IncomeBody ledger={query.data} today={today} />
      )}
    </div>
  );
}

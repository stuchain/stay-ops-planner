"use client";

import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined, ChevronDown, Download, FileText, Table2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { LedgerYearData } from "@/api/types";
import { Badge } from "@/ui/Badge";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { compactSelectClass } from "@/ui/field";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { formatMoney } from "@/ui/format";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { ExcelSheet } from "./ExcelSheet";
import { changeOnLastYear, formatChange, incomeView, type IncomeView } from "./incomeView";
import { TaxFold } from "./TaxCard";

export type IncomeScreenProps = {
  /** Today in the business time zone, from the server. */
  today: IsoDate;
  /** Admin with Dev mode on: also shows the way to Statistics. */
  devMode?: boolean;
};

function MonthTable({ ledger, view }: { ledger: LedgerYearData; view: IncomeView }) {
  const t = useTranslations();
  const locale = useLocale();
  const money = (cents: number) => formatMoney(cents, locale);
  const cell = "px-3 py-3 text-right tabular-nums whitespace-nowrap";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-base phone:text-sm">
        <thead>
          <tr className="border-text-muted border-b-2">
            <th scope="col" className="px-3 py-3 text-left font-bold">
              {t("income.colMonth")}
            </th>
            {ledger.apartments.map((a) => (
              <th key={a.index} scope="col" className="px-3 py-3 text-right font-bold whitespace-nowrap">
                {a.label}
              </th>
            ))}
            <th scope="col" className="px-3 py-3 text-right font-bold">
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
              <th scope="row" className="px-3 py-3 text-left font-medium whitespace-nowrap">
                {t("common.month", { month: m.month })}{" "}
                {m.kind === "expected" ? <span className="text-text-muted">{t("income.monthExpected")}</span> : null}
                {m.kind === "current" ? <Badge tone="info">{t("income.now")}</Badge> : null}
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
            <th scope="row" className="px-3 py-3 text-left">
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

function ExportButton({ year }: { year: number }) {
  const t = useTranslations();
  return (
    <a
      href={`/api/money/export?year=${year}`}
      download
      className={cn(buttonBase, buttonVariants.primary, buttonSizes.lg, "self-start")}
    >
      <Download size={24} aria-hidden="true" />
      {t("income.export")}
    </a>
  );
}

type IncomeViewMode = "normal" | "excel";
const VIEW_KEY = "stayops.money.view";

/** The father picks a side once; the screen opens on it next time (on this device). */
function useViewMode(): [IncomeViewMode, (mode: IncomeViewMode) => void] {
  const [mode, setMode] = useState<IncomeViewMode>("normal");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_KEY) === "excel") setMode("excel");
    } catch {
      // Storage blocked: start on the normal view.
    }
  }, []);
  return [
    mode,
    (next) => {
      setMode(next);
      try {
        window.localStorage.setItem(VIEW_KEY, next);
      } catch {
        // Not remembered, still switched.
      }
    },
  ];
}

function ViewSwitch({ mode, onChange }: { mode: IncomeViewMode; onChange: (mode: IncomeViewMode) => void }) {
  const t = useTranslations();
  return (
    <ChoiceGroup<IncomeViewMode>
      size="md"
      label={t("income.sheet.viewLabel")}
      value={mode}
      onChange={onChange}
      choices={[
        { value: "normal", label: t("income.sheet.viewNormal") },
        { value: "excel", label: t("income.sheet.viewExcel") },
      ]}
    />
  );
}

function IncomeBody({
  ledger,
  today,
  devMode,
  onOpenExcel,
}: {
  ledger: LedgerYearData;
  today: IsoDate;
  devMode: boolean;
  /** Opens the "Σαν το Excel" view, where the bookings that count in no apartment are listed. */
  onOpenExcel: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const trpc = useTRPC();
  const money = (cents: number) => formatMoney(cents, locale);
  const view = useMemo(() => incomeView(ledger, today), [ledger, today]);
  const past = ledger.year < Number(today.slice(0, 4));
  // Same months last year, counted the same way; nothing is said when there is no such year.
  const hasLastYear = ledger.years.includes(ledger.year - 1);
  const lastYear = useQuery({ ...trpc.money.year.queryOptions({ year: ledger.year - 1 }), enabled: hasLastYear });
  const change =
    hasLastYear && lastYear.data ? changeOnLastYear(view.soFarCents, lastYear.data, ledger.year, today) : null;
  const perApartmentTax = ledger.tax.scope === "total" ? null : ledger.tax.calculations;

  return (
    <>
      <Card data-testid="income-so-far" className="gap-2">
        <span className="text-text-muted text-lg">{past ? t("income.soFarPast") : t("income.soFar")}</span>
        <span className="text-4xl font-bold tabular-nums">{money(view.soFarCents)}</span>
        {view.expectedCents !== 0 || change !== null ? (
          <p className="text-text-muted text-lg">
            {view.expectedCents !== 0 ? (
              <>
                {t("income.stillComing")} <b className="text-text tabular-nums">{money(view.expectedCents)}</b>
              </>
            ) : null}
            {view.expectedCents !== 0 && change !== null ? " · " : null}
            {change !== null ? (
              <>
                {t("income.vsLastYear")}{" "}
                <b className={cn("tabular-nums", change > 0 ? "text-success-text" : change < 0 && "text-danger")}>
                  {formatChange(change)}
                </b>
              </>
            ) : null}
          </p>
        ) : null}
        <p className="text-text-muted">{t("income.taxLine", { amount: money(ledger.tax.taxCents) })}</p>
      </Card>

      {ledger.totals.unbucketedCount > 0 ? (
        <div
          role="status"
          className="bg-warning-soft text-warning-text rounded-card flex flex-wrap items-center gap-3 px-4 py-3"
        >
          <TriangleAlert size={24} className="shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {t("income.unbucketed", {
              count: ledger.totals.unbucketedCount,
              amount: money(ledger.totals.unbucketedCents),
            })}
          </span>
          <button
            type="button"
            onClick={onOpenExcel}
            className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg)}
          >
            {t("income.unbucketedOpen")}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-4 narrow:grid-cols-2 small:grid-cols-1">
        {ledger.apartments.map((a, i) => (
          <div key={a.index} className="border-border rounded-card bg-surface flex flex-col gap-1 border p-4">
            <span className="text-lg font-semibold">{a.label}</span>
            <span className="text-xl font-bold tabular-nums">{money(ledger.totals.byRentalCents[i] ?? 0)}</span>
            {perApartmentTax?.[i] ? (
              <span className="text-text-muted">
                {t("income.apartmentTax", { amount: money(perApartmentTax[i].taxCents) })}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <Card
        title={
          <span className="flex items-center gap-2">
            <Table2 size={24} aria-hidden="true" />
            {t("income.perMonth")}
          </span>
        }
      >
        <MonthTable ledger={ledger} view={view} />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <ExportButton year={ledger.year} />
        <Link
          href={`/app/excel/report?year=${ledger.year}`}
          className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg)}
        >
          <FileText size={24} aria-hidden="true" />
          {t("income.report")}
        </Link>
        {devMode ? (
          <Link href="/app/stats" className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg)}>
            <ChartNoAxesCombined size={24} aria-hidden="true" />
            {t("income.statistics")}
          </Link>
        ) : null}
        <TaxFold ledger={ledger} />
      </div>
    </>
  );
}

/** Έσοδα: the year at a glance for the father, or the same year laid out like his Excel sheet. */
export function IncomeScreen({ today, devMode = false }: IncomeScreenProps) {
  const t = useTranslations();
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const query = useQuery({ ...trpc.money.year.queryOptions({ year }), placeholderData: (prev) => prev });
  const years = query.data?.years ?? [year];
  const [mode, setMode] = useViewMode();
  const thisYear = year === Number(today.slice(0, 4));

  return (
    <div className={cn("mx-auto flex flex-col gap-6 p-6 phone:p-4", mode === "excel" ? "max-w-[90rem]" : "max-w-6xl")}>
      <PageHeader
        title={t("income.title")}
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <ViewSwitch mode={mode} onChange={setMode} />
            <label className="flex items-center gap-3 text-base font-medium">
              {t("income.year")}
              <span className="relative">
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={compactSelectClass}>
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
          </div>
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
      ) : mode === "excel" ? (
        <>
          <ExcelSheet ledger={query.data} currentMonth={thisYear ? Number(today.slice(5, 7)) : null} onYear={setYear} />
          <ExportButton year={query.data.year} />
        </>
      ) : (
        <IncomeBody ledger={query.data} today={today} devMode={devMode} onOpenExcel={() => setMode("excel")} />
      )}
    </div>
  );
}

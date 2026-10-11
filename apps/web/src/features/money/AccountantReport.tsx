"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { bucketAmount, type IsoDate, type LedgerValues } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { LedgerRowData, LedgerYearData } from "@/api/types";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { formatDay, formatMoney } from "@/ui/format";
import { Skeleton } from "@/ui/Skeleton";
import { formatRate } from "./incomeView";
import "./report.css";

type Calculation = LedgerYearData["tax"]["calculations"][number];

const th = "px-2 py-1.5 font-bold";
const num = "px-2 py-1.5 text-right tabular-nums";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 break-inside-avoid-page">
      <h2 className="border-text border-b-2 pb-1 text-[14pt] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function BracketTable({ calc, caption }: { calc: Calculation; caption?: string }) {
  const t = useTranslations("accountantReport");
  const locale = useLocale();
  const money = (cents: number) => formatMoney(cents, locale);
  const range = (line: Calculation["lines"][number]) => {
    if (line.upToCents === null) return t("rangeAbove", { from: money(line.fromCents) });
    if (line.fromCents === 0) return t("rangeUpTo", { upTo: money(line.upToCents) });
    return t("rangeBetween", { from: money(line.fromCents), upTo: money(line.upToCents) });
  };
  return (
    <table className="w-full border-collapse text-[11pt]">
      {caption ? <caption className="mb-1 text-left font-bold">{caption}</caption> : null}
      <thead className="table-header-group">
        <tr className="border-text border-b">
          <th scope="col" className={cn(th, "text-left")}>
            {t("bracket")}
          </th>
          <th scope="col" className={cn(th, "text-right")}>
            {t("rate")}
          </th>
          <th scope="col" className={cn(th, "text-right")}>
            {t("taxedAmount")}
          </th>
          <th scope="col" className={cn(th, "text-right")}>
            {t("taxCol")}
          </th>
        </tr>
      </thead>
      <tbody>
        {calc.lines.map((line) => (
          <tr key={line.fromCents} className="border-border break-inside-avoid border-b">
            <th scope="row" className="px-2 py-1.5 text-left font-normal">
              {range(line)}
            </th>
            <td className={num}>{formatRate(line.rateBps, locale)}</td>
            <td className={num}>{money(line.taxedCents)}</td>
            <td className={num}>{money(line.taxCents)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-text border-t font-bold">
          <th scope="row" className="px-2 py-1.5 text-left">
            {t("sum")}
          </th>
          <td />
          <td className={num}>{money(calc.incomeCents)}</td>
          <td className={num}>{money(calc.taxCents)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function ApartmentTotals({ ledger }: { ledger: LedgerYearData }) {
  const t = useTranslations();
  const locale = useLocale();
  const money = (cents: number) => formatMoney(cents, locale);
  return (
    <table className="w-full border-collapse text-[11pt]">
      <thead className="table-header-group">
        <tr className="border-text border-b">
          {ledger.apartments.map((a) => (
            <th key={a.index} scope="col" className={cn(th, "text-right")}>
              {a.label}
            </th>
          ))}
          <th scope="col" className={cn(th, "text-right")}>
            {t("income.colTotal")}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-border border-b">
          {ledger.totals.byRentalCents.map((v, i) => (
            <td key={i} className={num}>
              {money(v)}
            </td>
          ))}
          <td className={cn(num, "font-bold")}>{money(ledger.totals.totalCents)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function BookingsTable({ ledger }: { ledger: LedgerYearData }) {
  const t = useTranslations();
  const locale = useLocale();
  const money = (cents: number | null) => (cents === null ? "" : formatMoney(cents, locale));
  const basis = ledger.rules.incomeBasis;
  const counted = ledger.rows.filter((r) => r.counts);
  const months = [...new Set(counted.map((r) => r.month))];
  const channelText = (row: LedgerRowData) =>
    row.channel === null ? t("income.ledger.kind.manual") : t(`channel.${row.channel}`);
  const when = (row: LedgerRowData) => row.shown.dateRange || t("common.month", { month: row.month });
  const cell = "px-1.5 py-1 align-top";
  return (
    <table className="w-full border-collapse text-[10pt]">
      <thead className="table-header-group">
        <tr className="border-text border-b-2">
          <th scope="col" className={cn(cell, "text-left font-bold")}>
            {t("accountantReport.colDates")}
          </th>
          <th scope="col" className={cn(cell, "text-left font-bold")}>
            {t("income.ledger.col.name")}
          </th>
          <th scope="col" className={cn(cell, "text-left font-bold")}>
            {t("accountantReport.colChannel")}
          </th>
          {ledger.apartments.map((a) => (
            <th key={a.index} scope="col" className={cn(cell, "text-right font-bold")}>
              {a.label}
            </th>
          ))}
          <th scope="col" className={cn(cell, "text-right font-bold")}>
            {t("accountantReport.colAmount")}
          </th>
        </tr>
      </thead>
      {months.map((month) => {
        const monthly = ledger.totals.monthlyCents[month - 1] ?? [];
        return (
          <tbody key={month}>
            <tr className="break-after-avoid">
              <th scope="colgroup" colSpan={8} className="bg-surface-muted px-1.5 py-1 text-left text-[11pt] font-bold">
                {t("common.month", { month })}
              </th>
            </tr>
            {counted
              .filter((r) => r.month === month)
              .map((row) => (
                <tr key={row.key} className="border-border break-inside-avoid border-b">
                  <td className={cn(cell, "whitespace-nowrap")}>{when(row)}</td>
                  <td className={cell}>
                    {row.shown.name || t("common.noName")}
                    {row.kind === "cancelled_paid" ? (
                      <span className="block text-[9pt]">{t("income.ledger.kind.cancelled_paid")}</span>
                    ) : null}
                  </td>
                  <td className={cell}>{channelText(row)}</td>
                  {row.shown.rentalCents.map((v, i) => (
                    <td key={i} className={cn(cell, "text-right tabular-nums")}>
                      {money(v)}
                    </td>
                  ))}
                  <td className={cn(cell, "text-right tabular-nums")}>
                    {money(bucketAmount(row.shown as LedgerValues, basis))}
                  </td>
                </tr>
              ))}
            <tr className="border-text break-inside-avoid border-y font-bold">
              <th scope="row" colSpan={3} className={cn(cell, "text-left")}>
                {t("accountantReport.monthTotal", { month: t("common.month", { month }) })}
              </th>
              {monthly.map((v, i) => (
                <td key={i} className={cn(cell, "text-right tabular-nums")}>
                  {money(v)}
                </td>
              ))}
              <td className={cn(cell, "text-right tabular-nums")}>{money(monthly.reduce((s, v) => s + v, 0))}</td>
            </tr>
          </tbody>
        );
      })}
      <tfoot>
        <tr className="border-text border-t-2 text-[11pt] font-bold">
          <th scope="row" colSpan={3} className={cn(cell, "text-left")}>
            {t("income.yearTotal")}
          </th>
          {ledger.totals.byRentalCents.map((v, i) => (
            <td key={i} className={cn(cell, "text-right tabular-nums")}>
              {money(v)}
            </td>
          ))}
          <td className={cn(cell, "text-right tabular-nums")}>{money(ledger.totals.totalCents)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function Sheet({ ledger, today }: { ledger: LedgerYearData; today: IsoDate }) {
  const t = useTranslations("accountantReport");
  const locale = useLocale();
  const money = (cents: number) => formatMoney(cents, locale);
  const { rules, tax, totals, apartments } = ledger;
  const excluded = ledger.rows.filter((r) => !r.counts).length;
  const produced = t("produced", { date: formatDay(today, locale === "en" ? "en" : "el", true) });
  return (
    <article className="report-sheet bg-surface text-text rounded-card shadow-card mx-auto flex w-full max-w-[210mm] flex-col gap-6 p-8 text-[11pt] max-[759px]:p-4 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      <header className="flex flex-col gap-1">
        <p className="text-text-muted text-[11pt]">{t("kicker")}</p>
        <h1 className="text-[22pt] leading-tight font-bold">{t("title", { year: ledger.year })}</h1>
        <p>{produced}</p>
      </header>

      <Section title={t("totalsTitle")}>
        <div className="overflow-x-auto print:overflow-visible">
          <ApartmentTotals ledger={ledger} />
        </div>
        {totals.unbucketedCount > 0 ? (
          <p className="border-text flex items-start gap-2 border-2 p-3 font-semibold">
            <TriangleAlert size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t("unbucketed", { count: totals.unbucketedCount, amount: money(totals.unbucketedCents) })}
          </p>
        ) : null}
      </Section>

      <Section title={t("basisTitle")}>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>{rules.incomeBasis === "gross" ? t("basisGross") : t("basisPayout")}</li>
          <li>{rules.scope === "total" ? t("scopeTotal") : t("scopePerApartment")}</li>
          <li>{t("cancelled")}</li>
        </ul>
        {rules.confirmed ? (
          <p className="font-semibold">{t("confirmed")}</p>
        ) : (
          <p role="alert" className="border-text flex items-start gap-2 border-2 p-3 font-bold">
            <TriangleAlert size={22} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t("unconfirmed")}
          </p>
        )}
      </Section>

      <Section title={t("taxTitle")}>
        <div className="flex flex-col gap-4 overflow-x-auto print:overflow-visible">
          {tax.scope === "total" ? (
            <BracketTable calc={tax.calculations[0]!} />
          ) : (
            tax.calculations.map((calc, i) => (
              <BracketTable key={i} calc={calc} caption={t("taxFor", { apartment: apartments[i]?.label ?? "" })} />
            ))
          )}
        </div>
        <p className="flex items-baseline justify-between gap-4 text-[14pt] font-bold">
          <span>{t("totalTax")}</span>
          <span className="tabular-nums">{money(tax.taxCents)}</span>
        </p>
      </Section>

      <section className="flex flex-col gap-3">
        <h2 className="border-text border-b-2 pb-1 text-[14pt] font-bold">{t("bookingsTitle")}</h2>
        <div className="overflow-x-auto print:overflow-visible">
          <BookingsTable ledger={ledger} />
        </div>
        {excluded > 0 ? <p className="text-[10pt]">{t("excluded", { count: excluded })}</p> : null}
      </section>
    </article>
  );
}

export type AccountantReportProps = {
  year: number;
  /** Today in the business time zone, from the server. */
  today: IsoDate;
};

/** A print-ready A4 report of the year for the accountant, from the same ledger as the screen and the Excel file. */
export function AccountantReport({ year, today }: AccountantReportProps) {
  const t = useTranslations("accountantReport");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const query = useQuery(trpc.money.year.queryOptions({ year }));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 max-[759px]:p-4 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/app/excel" className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg)}>
          <ArrowLeft size={24} aria-hidden="true" />
          {t("back")}
        </Link>
        <div className="flex flex-col items-end gap-1 max-[759px]:items-start">
          <button
            type="button"
            disabled={!query.data}
            onClick={() => window.print()}
            className={cn(buttonBase, buttonVariants.primary, buttonSizes.lg)}
          >
            <Printer size={24} aria-hidden="true" />
            {t("print")}
          </button>
          <p className="text-text-muted text-sm">{t("printHint")}</p>
        </div>
      </div>
      {query.error && !query.data ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton variant="block" className="h-40" />
          <Skeleton variant="block" className="h-72" />
        </div>
      ) : (
        <Sheet ledger={query.data} today={today} />
      )}
    </div>
  );
}

"use client";

import { Landmark } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { LedgerYearData } from "@/api/types";
import { Card } from "@/ui/Card";
import { formatMoney } from "@/ui/format";
import { formatRate } from "./incomeView";

type Calculation = LedgerYearData["tax"]["calculations"][number];
type Line = Calculation["lines"][number];

function EstimatePill() {
  const t = useTranslations("income");
  return (
    <span className="bg-warning-soft text-warning-text rounded-full px-2.5 py-0.5 text-sm font-semibold">
      {t("estimate")}
    </span>
  );
}

function BracketTable({ calc, caption }: { calc: Calculation; caption?: string }) {
  const t = useTranslations("income");
  const locale = useLocale();
  const money = (cents: number) => formatMoney(cents, locale);
  const label = (line: Line) => {
    const rate = formatRate(line.rateBps, locale);
    if (line.upToCents === null) return t("bracketAbove", { rate, from: money(line.fromCents) });
    if (line.fromCents === 0) return t("bracketUpTo", { rate, upTo: money(line.upToCents) });
    return t("bracketBetween", { rate, from: money(line.fromCents), upTo: money(line.upToCents) });
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-base">
        {caption ? <caption className="mb-2 text-left font-semibold">{caption}</caption> : null}
        <thead>
          <tr className="border-text-muted border-b-2">
            <th scope="col" className="px-3 py-2.5 text-left font-bold">
              {t("bracket")}
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-bold whitespace-nowrap">
              {t("incomeInBracket")}
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-bold">
              {t("taxCol")}
            </th>
          </tr>
        </thead>
        <tbody>
          {calc.lines.map((line) => (
            <tr key={line.fromCents} className="border-border border-b">
              <th scope="row" className="px-3 py-2.5 text-left font-medium">
                {label(line)}
              </th>
              <td className="px-3 py-2.5 text-right tabular-nums">{money(line.taxedCents)}</td>
              <td className="px-3 py-2.5 text-right font-bold tabular-nums">{money(line.taxCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-text-muted border-t-2 font-bold">
            <th scope="row" className="px-3 py-2.5 text-left">
              {t("estimatedTax")}
            </th>
            <td className="px-3 py-2.5 text-right tabular-nums">{money(calc.incomeCents)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums">{money(calc.taxCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The bracket calculation and a plain explanation of how the estimate is worked out. */
export function TaxCard({ ledger }: { ledger: LedgerYearData }) {
  const t = useTranslations("income");
  const { rules, tax, apartments } = ledger;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Landmark size={24} aria-hidden="true" />
          {t("taxTitle")}
          <EstimatePill />
        </span>
      }
    >
      {tax.scope === "total" ? (
        <BracketTable calc={tax.calculations[0]!} />
      ) : (
        tax.calculations.map((calc, i) => (
          <BracketTable key={i} calc={calc} caption={t("taxFor", { apartment: apartments[i]?.label ?? "" })} />
        ))
      )}
      <p>{t("taxNote")}</p>
      {!rules.confirmed ? <p className="text-warning-text">{t("taxUnconfirmed")}</p> : null}
      <details className="border-border rounded-sm border px-4 py-3">
        <summary className="min-h-target text-accent flex cursor-pointer items-center font-semibold">
          {t("how.title")}
        </summary>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
          <li>{t("how.year")}</li>
          <li>{rules.incomeBasis === "gross" ? t("how.gross") : t("how.payout")}</li>
          <li>{t("how.cancelled")}</li>
          <li>{rules.scope === "total" ? t("how.total") : t("how.perApartment")}</li>
        </ul>
      </details>
    </Card>
  );
}

export { EstimatePill };

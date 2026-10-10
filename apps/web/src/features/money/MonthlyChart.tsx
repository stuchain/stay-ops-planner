"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type CSSProperties } from "react";
import type { LedgerApartmentData } from "@/api/types";
import { cn } from "@/ui/cn";
import { formatMoney } from "@/ui/format";
import type { MonthView } from "./incomeView";

export type MonthlyChartProps = {
  year: number;
  months: MonthView[];
  apartments: readonly LedgerApartmentData[];
};

/** Apartment colour, from the room settings or the design tokens. */
export function apartmentColor(a: LedgerApartmentData): string {
  return (
    a.color ?? ["var(--color-onar)", "var(--color-cosmos)", "var(--color-iris)", "var(--color-helios)"][a.index - 1]!
  );
}

/**
 * One stacked bar per month, an apartment per segment (in the apartments' fixed colours).
 * Months still to come are hatched. Hovering or focusing a month shows its amounts.
 */
export function MonthlyChart({ year, months, apartments }: MonthlyChartProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => m.totalCents));
  const money = (cents: number) => formatMoney(cents, locale);

  return (
    <figure className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-2 text-sm" aria-hidden="true">
        {apartments.map((a) => (
          <li key={a.index} className="border-border flex items-center gap-2 rounded-full border px-3 py-1">
            <span className="size-3 rounded-sm" style={{ background: apartmentColor(a) }} />
            {a.label}
          </li>
        ))}
        <li className="border-border flex items-center gap-2 rounded-full border px-3 py-1">
          <span className="bg-text-muted size-3 rounded-sm" />
          {t("income.legendActual")}
        </li>
        <li className="border-border flex items-center gap-2 rounded-full border px-3 py-1">
          <span className="money-hatch bg-text-muted size-3 rounded-sm" />
          {t("income.legendExpected")}
        </li>
      </ul>
      <div
        role="list"
        aria-label={t("income.chartLabel", { year })}
        className="grid grid-cols-12 gap-2 max-[759px]:grid-cols-1 max-[759px]:gap-1.5"
      >
        {months.map((m) => {
          const label = t("common.month", { month: m.month });
          const segments = apartments
            .map((a, i) => ({ a, value: Math.max(0, m.perApartment[i] ?? 0) }))
            .filter((s) => s.value > 0);
          const detail = apartments.map((a, i) => `${a.label} ${money(m.perApartment[i] ?? 0)}`).join(", ");
          return (
            <div
              key={m.month}
              role="listitem"
              tabIndex={0}
              aria-label={`${label}: ${money(m.totalCents)}. ${detail}`}
              onMouseEnter={() => setActive(m.month)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(m.month)}
              onBlur={() => setActive(null)}
              className={cn(
                "relative flex min-w-0 flex-col items-center justify-end gap-1.5 rounded-sm px-0.5 pt-2 pb-1.5",
                "max-[759px]:flex-row max-[759px]:justify-start max-[759px]:gap-3 max-[759px]:px-2.5 max-[759px]:py-2",
                m.kind === "current" && "bg-accent-soft outline-accent outline-3 -outline-offset-3",
              )}
            >
              <span
                className={cn(
                  "text-xs whitespace-nowrap tabular-nums max-[759px]:order-3 max-[759px]:ml-auto",
                  m.kind === "expected" ? "text-text-muted" : "font-semibold",
                )}
              >
                {money(m.totalCents)}
              </span>
              <div className="flex h-44 w-full items-end justify-center max-[759px]:order-2 max-[759px]:h-5 max-[759px]:flex-1 max-[759px]:justify-start">
                <div
                  className={cn(
                    "flex h-(--bar) w-3/5 max-w-10 flex-col-reverse gap-0.5 overflow-hidden rounded-t-[4px]",
                    "max-[759px]:h-full max-[759px]:w-(--bar) max-[759px]:max-w-none max-[759px]:flex-row max-[759px]:rounded-t-none max-[759px]:rounded-r-[4px]",
                  )}
                  style={{ "--bar": `${(m.totalCents / max) * 100}%` } as CSSProperties}
                >
                  {segments.map(({ a, value }) => (
                    <span
                      key={a.index}
                      className={cn("block min-h-0.5", m.kind === "expected" && "money-hatch")}
                      style={{ backgroundColor: apartmentColor(a), flexGrow: value }}
                    />
                  ))}
                </div>
              </div>
              <span className="text-center text-sm font-medium max-[759px]:order-1 max-[759px]:w-24 max-[759px]:text-left">
                <span className="max-[759px]:hidden">{t("income.monthShort", { month: m.month })}</span>
                <span className="hidden max-[759px]:inline">{label}</span>
                {m.kind === "current" ? (
                  <span className="text-accent block text-xs font-bold">{t("income.now")}</span>
                ) : null}
              </span>
              {active === m.month ? (
                <div
                  role="tooltip"
                  className="bg-surface border-border shadow-raised absolute bottom-full z-10 mb-2 w-48 rounded-sm border p-3 text-left text-sm max-[759px]:hidden"
                >
                  <p className="mb-1 font-semibold">{label}</p>
                  <ul className="flex flex-col gap-0.5">
                    {apartments.map((a, i) => (
                      <li key={a.index} className="flex items-center gap-2">
                        <span className="size-2.5 rounded-sm" style={{ background: apartmentColor(a) }} />
                        <span className="flex-1">{a.label}</span>
                        <span className="tabular-nums">{money(m.perApartment[i] ?? 0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

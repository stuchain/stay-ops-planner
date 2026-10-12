"use client";

import { useTranslations } from "next-intl";
import { percentChange } from "@stay-ops/domain";
import { cn } from "@/ui/cn";

/**
 * This year against last year. `kind` "percent" shows the relative change (+12%), "points" the
 * difference of two percentages (+5 points), "number" the plain difference. With `lowerIsBetter`
 * a fall is shown in green (cancellations).
 */
export function Delta({
  now,
  before,
  kind = "percent",
  lowerIsBetter = false,
  className,
}: {
  now: number | null;
  before: number | null;
  kind?: "percent" | "points" | "number";
  lowerIsBetter?: boolean;
  className?: string;
}) {
  const t = useTranslations("stats.delta");
  if (now === null || before === null) return null;
  const change = kind === "percent" ? percentChange(now, before) : Math.round((now - before) * 100) / 100;
  // Nothing last year: the "last year" figure next to it says enough.
  if (change === null) return null;
  if (change === 0) return <span className={cn("text-text-muted text-sm", className)}>{t("same")}</span>;
  const good = lowerIsBetter ? change < 0 : change > 0;
  const size = Math.abs(change);
  const shown =
    kind === "percent"
      ? t("percent", { value: size })
      : kind === "points"
        ? t("points", { value: size })
        : t("number", { value: size });
  return (
    <span className={cn("text-sm font-semibold", good ? "text-success-text" : "text-danger", className)}>
      <span aria-hidden="true">
        {change > 0 ? "▲" : "▼"} {shown}
      </span>
      <span className="sr-only">{change > 0 ? t("up", { change: shown }) : t("down", { change: shown })}</span>
    </span>
  );
}

"use client";

import { Check, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { TurnoverTask } from "@/api/types";
import { cn } from "@/ui/cn";

type Kind = TurnoverTask["kind"];

/** The colours of A-A, A and S, on the calendar tags and the chips. */
export const KIND_STYLE: Record<Kind, string> = {
  AA: "border-warning bg-warning-soft text-warning-text",
  A: "border-accent bg-accent-soft text-accent",
  S: "border-text-muted bg-surface text-text border-dashed",
};

/** "A-A", "A" or "S" in its frame; green with a tick once done. */
export function KindChip({ kind, done }: { kind: Kind; done?: boolean }) {
  const t = useTranslations("cleaningCalendar");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1 rounded-sm border-2 px-2 text-base font-bold whitespace-nowrap",
        done ? "border-success bg-success-soft text-success-text" : KIND_STYLE[kind],
      )}
    >
      {done ? <Check size={16} aria-hidden="true" /> : kind === "AA" ? <Lock size={14} aria-hidden="true" /> : null}
      {t(`kinds.${kind}.short`)}
    </span>
  );
}

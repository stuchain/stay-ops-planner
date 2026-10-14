"use client";

import { CalendarDays, List } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cn } from "@/ui/cn";
import { CleaningCalendar } from "./CleaningCalendar";
import { TurnoversScreen } from "./TurnoversScreen";

type View = "calendar" | "list";

const STORAGE_KEY = "stay-ops.cleaning-view";

/**
 * The Cleaning page: the calendar with the stays (to plan) or the list by day (to tick off and print). The choice
 * is remembered on this computer. Printing always prints the list.
 */
export function CleaningScreen() {
  const t = useTranslations("cleaningCalendar");
  const [view, setView] = useState<View>("calendar");
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "list") setView("list");
    } catch {
      // Storage can be blocked; the calendar is the default.
    }
  }, []);

  function choose(next: View) {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered, which is fine.
    }
  }

  // The list is what goes on paper: switch to it, let it draw, then open the print dialog.
  useEffect(() => {
    if (!printing || view !== "list") return;
    const timer = window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [printing, view]);

  const viewSwitch = (
    <div
      role="group"
      aria-label={t("view.label")}
      className="border-border bg-surface inline-flex overflow-hidden rounded-sm border print:hidden"
    >
      {(
        [
          { key: "calendar", icon: CalendarDays },
          { key: "list", icon: List },
        ] as const
      ).map(({ key, icon: Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          onClick={() => choose(key)}
          className={cn(
            "min-h-target flex items-center gap-2 px-4 text-base font-semibold",
            view === key ? "bg-accent-soft text-accent" : "text-text",
          )}
        >
          <Icon size={20} aria-hidden="true" />
          {t(`view.${key}`)}
        </button>
      ))}
    </div>
  );

  return view === "calendar" ? (
    <CleaningCalendar
      viewSwitch={viewSwitch}
      onPrint={() => {
        choose("list");
        setPrinting(true);
      }}
    />
  ) : (
    <TurnoversScreen viewSwitch={viewSwitch} />
  );
}

"use client";

import { CalendarRange, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { cn } from "@/ui/cn";

/** "Αναζήτηση" button that opens the booking search. */
export function SearchLink({ className }: { className?: string }) {
  const t = useTranslations("search");
  return (
    <Link href="/app/search" className={cn(buttonBase, buttonVariants.secondary, buttonSizes.md, className)}>
      <Search size={24} aria-hidden="true" />
      {t("open")}
    </Link>
  );
}

/** "Η εβδομάδα" button that opens the weekly summary. */
export function WeekLink({ className }: { className?: string }) {
  const t = useTranslations("week");
  return (
    <Link href="/app/week" className={cn(buttonBase, buttonVariants.secondary, buttonSizes.md, className)}>
      <CalendarRange size={24} aria-hidden="true" />
      {t("open")}
    </Link>
  );
}

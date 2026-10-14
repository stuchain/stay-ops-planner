"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PageHeader } from "@/ui/PageHeader";

/** Dev mode: the old cleaning board (passed in as children), unchanged, until Phase 4 decides its future. */
export function CleaningScreen({ children }: { children: ReactNode }) {
  const t = useTranslations("dev.cleaning");
  return (
    <div className="flex flex-col gap-6 p-8 phone:p-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {children}
    </div>
  );
}

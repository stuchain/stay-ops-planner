"use client";

import { LinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/ui/EmptyState";

/** What the cleaner sees when the link is damaged, made up, or too old. */
export function LinkProblem({ reason }: { reason: "invalid" | "expired" }) {
  const t = useTranslations("cleanerLink");
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 p-4 pt-16">
      <EmptyState icon={LinkIcon} title={t(`${reason}.title`)} text={t(`${reason}.text`)} />
    </main>
  );
}

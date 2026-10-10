"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { useTRPC } from "@/api/client";
import { Skeleton } from "@/ui/Skeleton";
import { historySentence, type UiLocale } from "./historyText";

/** The last changes to a booking, one sentence each. */
export function BookingHistory({ bookingId }: { bookingId: string }) {
  const t = useTranslations("history");
  const locale = useLocale() as UiLocale;
  const trpc = useTRPC();
  const id = useId();
  const history = useQuery(trpc.booking.history.queryOptions({ bookingId }));
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2">
      <h3 id={`${id}-title`} className="text-base font-semibold">
        {t("title")}
      </h3>
      {history.isPending ? (
        <Skeleton variant="block" className="h-20" />
      ) : history.error || history.data.length === 0 ? (
        <p className="text-text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-border divide-y">
          {history.data.map((entry) => (
            <li key={entry.id} className="py-2">
              {historySentence(entry, (key, values) => t(key as "other", values), locale)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import type { PreviousStays } from "@/api/types";
import { formatMonthYear, type UiLocale } from "@/ui/format";

const SHOWN = 3;

type Stay = PreviousStays["sure"][number];

function StayList({ stays, sure }: { stays: Stay[]; sure: boolean }) {
  const t = useTranslations("guest");
  const locale = useLocale() as UiLocale;
  const text = stays
    .slice(0, SHOWN)
    .map((s) => t("stay", { apartment: s.apartment ?? t("noApartment"), month: formatMonthYear(s.checkin, locale) }))
    .join("; ");
  const more = stays.length - SHOWN;
  const line = t(sure ? "returning" : "maybeReturning", {
    stays: more > 0 ? `${text} ${t("more", { count: more })}` : text,
  });
  return <p className={sure ? "font-medium" : "text-text-muted text-sm"}>{line}</p>;
}

/** "Έχει ξαναέρθει: Cosmos, Αύγουστος 2025", and the weaker same-name hint. Nothing when there is none. */
export function ReturningLines({ previous }: { previous: PreviousStays }) {
  if (previous.sure.length === 0 && previous.maybe.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {previous.sure.length > 0 ? <StayList stays={previous.sure} sure /> : null}
      {previous.maybe.length > 0 ? <StayList stays={previous.maybe} sure={false} /> : null}
    </div>
  );
}

/** Earlier stays of the guest of a booking, for the booking panel. A failed lookup shows nothing. */
export function ReturningGuest({ bookingId }: { bookingId: string }) {
  const trpc = useTRPC();
  const previous = useQuery(trpc.booking.previousStays.queryOptions({ bookingId }));
  if (!previous.data) return null;
  return <ReturningLines previous={previous.data} />;
}

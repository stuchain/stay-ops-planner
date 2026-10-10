"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { ArrivalCardData } from "@/api/types";
import { ReturningLines } from "@/features/calendar/ReturningGuest";
import { Button } from "@/ui/Button";
import { DateText } from "@/ui/DateText";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border flex flex-col gap-0.5 border-b py-3">
      <dt className="text-text-muted text-base">{label}</dt>
      <dd className="text-xl font-semibold break-words">{children}</dd>
    </div>
  );
}

function PartyText({ card }: { card: ArrivalCardData }) {
  const t = useTranslations("arrivalCards");
  const common = useTranslations("common");
  const parts: string[] = [];
  if (card.adults) parts.push(t("adults", { count: card.adults }));
  if (card.children) parts.push(t("children", { count: card.children }));
  if (card.infants) parts.push(t("infants", { count: card.infants }));
  if (card.partySize === null && parts.length === 0) return <>{t("notGiven")}</>;
  return (
    <>
      {card.partySize !== null ? common("people", { count: card.partySize }) : null}
      {parts.length > 0 ? <span className="text-text-muted text-base font-normal"> ({parts.join(", ")})</span> : null}
    </>
  );
}

function Card({ card }: { card: ArrivalCardData }) {
  const t = useTranslations("arrivalCards");
  const tChannel = useTranslations("channel");
  const common = useTranslations("common");
  const locale = useLocale();
  const name = card.guestName ?? common("noName");
  return (
    <article
      aria-label={name}
      className="bg-surface border-border rounded-card flex flex-col gap-4 border p-8 shadow-card print:break-after-page print:rounded-none print:border-0 print:p-0 print:shadow-none print:last:break-after-auto"
    >
      <p className="text-text-muted text-lg font-semibold tracking-wide uppercase">{t("cardTitle")}</p>
      <h2 className="text-4xl font-bold break-words">{name}</h2>
      <ReturningLines previous={card.previousStays} />
      <dl className="grid grid-cols-2 gap-x-8 max-[759px]:grid-cols-1">
        <Row label={t("checkin")}>
          <DateText date={card.checkin as IsoDate} withYear locale={locale as "el" | "en"} />
        </Row>
        <Row label={t("checkout")}>
          <DateText date={card.checkout as IsoDate} withYear locale={locale as "el" | "en"} />
        </Row>
        <Row label={t("stay")}>{common("nights", { count: card.nights })}</Row>
        <Row label={t("apartment")}>{card.apartment ?? t("noApartment")}</Row>
        <Row label={t("people")}>
          <PartyText card={card} />
        </Row>
        <Row label={t("channel")}>{tChannel(card.channel)}</Row>
        <Row label={t("phone")}>
          {card.phone ? (
            <a href={`tel:${card.phone.replace(/[^\d+]/g, "")}`} className="underline">
              {card.phone}
            </a>
          ) : (
            t("notGiven")
          )}
        </Row>
        <Row label={t("email")}>{card.email ?? t("notGiven")}</Row>
      </dl>
      <section aria-label={t("notes")} className="flex flex-col gap-1">
        <h3 className="text-text-muted text-base">{t("notes")}</h3>
        {card.notes.length === 0 ? (
          <p className="text-lg">{t("noNotes")}</p>
        ) : (
          card.notes.map((note) => (
            <p key={note} className="text-xl whitespace-pre-line">
              {note}
            </p>
          ))
        )}
      </section>
    </article>
  );
}

/** Printable arrival cards, one per A4 page. The sidebar and banners are hidden when printing. */
export function ArrivalCardsScreen({ ids }: { ids: string[] }) {
  const t = useTranslations("arrivalCards");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const cards = useQuery({ ...trpc.booking.arrivalCards.queryOptions({ ids }), enabled: ids.length > 0 });

  return (
    <div className="flex flex-col gap-6 p-8 max-[759px]:p-4 print:p-0">
      <PageHeader
        className="print:hidden"
        title={t("title")}
        subtitle={cards.data ? t("count", { count: cards.data.length }) : undefined}
        actions={
          <Button
            variant="primary"
            size="lg"
            icon={Printer}
            disabled={!cards.data?.length}
            onClick={() => window.print()}
          >
            {t("print")}
          </Button>
        }
      />
      {ids.length === 0 ? (
        <EmptyState icon={Printer} title={t("noIdsTitle")} text={t("noIdsText")} />
      ) : cards.error ? (
        <ErrorState message={errorText(cards.error)} onRetry={() => void cards.refetch()} />
      ) : !cards.data ? (
        <Skeleton variant="block" className="h-96" />
      ) : cards.data.length === 0 ? (
        <EmptyState icon={Printer} title={t("noneFoundTitle")} text={t("noneFoundText")} />
      ) : (
        cards.data.map((card) => <Card key={card.id} card={card} />)
      )}
    </div>
  );
}

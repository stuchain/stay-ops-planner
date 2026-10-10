"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { BookingDetails } from "@/api/types";
import { MoneyText } from "@/ui/MoneyText";

/** The price in plain words: what the guest pays and what is left for the owner. Read only. */
export function BookingPrice({ price }: { price: BookingDetails["price"] }) {
  const t = useTranslations("bookingEdit");
  const id = useId();
  const rows: (readonly ["channelFee" | "cleaningFee" | "taxes" | "guestPaid", number | null])[] = price
    ? [
        ["channelFee", price.channelFeeCents],
        ["cleaningFee", price.cleaningFeeCents],
        ["taxes", price.taxCents],
        ["guestPaid", price.guestPaidCents],
      ]
    : [];
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2">
      <h3 id={`${id}-title`} className="text-base font-semibold">
        {t("priceTitle")}
      </h3>
      {price === null ? (
        <p className="text-text-muted">{t("noPrice")}</p>
      ) : (
        <>
          {price.kind === "pending" ? <p className="text-text-muted">{t("pendingPrice")}</p> : null}
          {price.kind === "cancelled_paid" || price.kind === "cancelled_unpaid" ? (
            <p className="text-text-muted">{t("cancelledPrice")}</p>
          ) : null}
          {price.foreignCurrency ? (
            <p className="text-warning-text">{t("foreignCurrency", { currency: price.currency ?? "" })}</p>
          ) : null}
          <dl className="divide-border divide-y">
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-text-muted">{t("total")}</dt>
              <dd className="font-semibold">
                <MoneyText cents={price.totalCents} />
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-text-muted">{t("net")}</dt>
              <dd className="font-semibold">
                <MoneyText cents={price.netCents} />
              </dd>
            </div>
          </dl>
          <details className="group">
            <summary className="min-h-target text-accent flex cursor-pointer items-center font-medium">
              {t("priceDetails")}
            </summary>
            <dl className="divide-border divide-y">
              {rows.map(([key, cents]) =>
                cents === null ? null : (
                  <div key={key} className="flex justify-between gap-4 py-2">
                    <dt className="text-text-muted">{t(key)}</dt>
                    <dd className="font-medium">
                      <MoneyText cents={cents} />
                    </dd>
                  </div>
                ),
              )}
            </dl>
            <p className="text-text-muted mt-2">{t("readOnlyHint")}</p>
          </details>
        </>
      )}
    </section>
  );
}

"use client";

import { useCallback, useId, useState } from "react";
import type { BookingDetailDto } from "./details";
import { fmtDeduction, fmtHosthubMoney } from "./priceFormat";

export { fmtHosthubMoney } from "./priceFormat";

type Money = BookingDetailDto["money"];

type PriceDetailsHosthubProps = {
  money: Money;
  nights: number;
};

export function PriceDetailsHosthub({ money, nights }: PriceDetailsHosthubProps) {
  const idBase = useId();
  const [dailyOpen, setDailyOpen] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);
  const toggleDaily = useCallback(() => setDailyOpen((o) => !o), []);
  const toggleTax = useCallback(() => setTaxOpen((o) => !o), []);

  const cur = money.currency;
  const bookingValue = money.bookingValue;
  const totalValueDisplay = money.totalValue ?? money.total;
  const nonZeroTaxLines = money.taxBreakdown.filter((t) => t.amount !== 0);

  return (
    <div className="ops-booking-grid-2 ops-price-hosthub">
      <h4 className="ops-price-section-title" id={`${idBase}-pd`}>
        Price details
      </h4>
      <div className="ops-detail-row ops-price-row-with-action">
        <span className="ops-detail-key">Booking value</span>
        <span className="ops-detail-value ops-price-value-with-chip">
          <span>{fmtHosthubMoney(bookingValue, cur)}</span>
          {nights > 0 && bookingValue !== null ? (
            <button
              type="button"
              className="ops-price-chip"
              aria-expanded={dailyOpen}
              aria-controls={`${idBase}-daily-list`}
              onClick={toggleDaily}
            >
              {dailyOpen ? "Hide daily breakdown" : "Show daily breakdown"}
            </button>
          ) : null}
        </span>
      </div>
      {dailyOpen && money.dailyBreakdown.length > 0 ? (
        <div className="ops-price-sublist" id={`${idBase}-daily-list`} role="region" aria-labelledby={`${idBase}-pd`}>
          {money.dailyBreakdown.map((row) => (
            <div key={row.date} className="ops-price-sublist-row">
              <span>{row.date}</span>
              <span>{fmtHosthubMoney(row.amount, cur)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="ops-detail-row">
        <span className="ops-detail-key">Cleaning fee</span>
        <span className="ops-detail-value">{fmtHosthubMoney(money.cleaningFee, cur)}</span>
      </div>
      <div className="ops-detail-row">
        <span className="ops-detail-key">Other fees</span>
        <span className="ops-detail-value">{fmtHosthubMoney(money.otherFees, cur)}</span>
      </div>

      <div className="ops-detail-row ops-price-row-with-action">
        <span className="ops-detail-key">Extra taxes collected by channel</span>
        <span className="ops-detail-value ops-price-value-with-chip">
          <span>{fmtHosthubMoney(money.extraTaxesByChannel, cur)}</span>
          {nonZeroTaxLines.length > 0 ? (
            <button
              type="button"
              className="ops-price-chip"
              aria-expanded={taxOpen}
              aria-controls={`${idBase}-tax-list`}
              onClick={toggleTax}
            >
              {taxOpen ? "Hide breakdown" : "Show breakdown"}
            </button>
          ) : null}
        </span>
      </div>
      {taxOpen && nonZeroTaxLines.length > 0 ? (
        <div className="ops-price-sublist" id={`${idBase}-tax-list`} role="region">
          {nonZeroTaxLines.map((row) => (
            <div key={row.key} className="ops-price-sublist-row">
              <span>{row.label}</span>
              <span>{fmtHosthubMoney(row.amount, cur)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="ops-detail-row ops-price-subtotal">
        <span className="ops-detail-key">Total value</span>
        <span className="ops-detail-value">
          <strong>{fmtHosthubMoney(totalValueDisplay, cur)}</strong>
        </span>
      </div>

      <h4 className="ops-price-section-title">Host</h4>
      <div className="ops-detail-row">
        <span className="ops-detail-key">Service fee host</span>
        <span className="ops-detail-value ops-price-deduction">{fmtDeduction(money.serviceFeeHost, cur)}</span>
      </div>
      <div className="ops-detail-row">
        <span className="ops-detail-key">Payment charges</span>
        <span className="ops-detail-value ops-price-deduction">{fmtDeduction(money.paymentCharges, cur)}</span>
      </div>
      <div className="ops-detail-row ops-price-subtotal">
        <span className="ops-detail-key">Total payout</span>
        <span className="ops-detail-value">
          <strong>{fmtHosthubMoney(money.payout, cur)}</strong>
        </span>
      </div>

      <h4 className="ops-price-section-title">Guest</h4>
      <div className="ops-detail-row">
        <span className="ops-detail-key">Service fee guest</span>
        <span className="ops-detail-value">{fmtHosthubMoney(money.serviceFeeGuest, cur)}</span>
      </div>
      <div className="ops-detail-row">
        <span className="ops-detail-key">Guest paid</span>
        <span className="ops-detail-value">{fmtHosthubMoney(money.guestPaid, cur)}</span>
      </div>

      <h4 className="ops-price-section-title">Other</h4>
      <div className="ops-detail-row ops-price-extras-block">
        <span className="ops-detail-key">Extras breakdown</span>
        <div className="ops-detail-value">
          {money.extrasIncluded.length === 0 ? (
            <span className="ops-muted">—</span>
          ) : (
            <ul className="ops-price-extras">
              {money.extrasIncluded.map((item, idx) => (
                <li key={`${idx}-${item.label.slice(0, 24)}`}>{item.label}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

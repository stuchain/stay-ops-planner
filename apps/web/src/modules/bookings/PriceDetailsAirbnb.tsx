import type { BookingDetailDto } from "./details";
import { fmtDeduction, fmtHosthubMoney } from "./priceFormat";

type Money = BookingDetailDto["money"];

export type PriceDetailsAirbnbProps = {
  money: Money;
};

export function PriceDetailsAirbnb({ money }: PriceDetailsAirbnbProps) {
  const cur = money.currency;
  const totalValueDisplay = money.totalValue ?? money.total;

  return (
    <div className="ops-booking-grid-2 ops-price-hosthub">
      <h4 className="ops-price-section-title">Price details</h4>
      <div className="ops-detail-row">
        <span className="ops-detail-key">Booking value</span>
        <span className="ops-detail-value">{fmtHosthubMoney(money.bookingValue, cur)}</span>
      </div>
      <div className="ops-detail-row">
        <span className="ops-detail-key">Cleaning fee</span>
        <span className="ops-detail-value">{fmtHosthubMoney(money.cleaningFee, cur)}</span>
      </div>
      <div className="ops-detail-row">
        <span className="ops-detail-key">Other fees</span>
        <span className="ops-detail-value">{fmtHosthubMoney(money.otherFees, cur)}</span>
      </div>
      <div className="ops-detail-row">
        <span className="ops-detail-key">Taxes</span>
        <span className="ops-detail-value">{fmtHosthubMoney(money.taxes, cur)}</span>
      </div>
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
        <span className="ops-detail-key">Service fee host base</span>
        <span className="ops-detail-value ops-price-deduction">{fmtDeduction(money.serviceFeeHostBase, cur)}</span>
      </div>
      <div className="ops-detail-row">
        <span className="ops-detail-key">Service fee host VAT</span>
        <span className="ops-detail-value ops-price-deduction">{fmtDeduction(money.serviceFeeHostVat, cur)}</span>
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

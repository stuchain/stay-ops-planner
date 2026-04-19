"use client";

import { useRef, type PointerEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { CalendarBookingItem } from "./calendarTypes";
import type { BookingSpanInMonth } from "./monthSpan";
import { bookingItemToDragPayload } from "./optimisticMove";
import { ChannelLogo } from "@/modules/bookings/ChannelLogo";

export function TimelineBookingBar({
  item,
  span,
  checkinCutIn,
  checkinMatePriorCheckout,
  turnoverIncoming,
  turnoverOutgoing,
  lane,
  nights,
  trailClipped,
  onOpen,
}: {
  item: CalendarBookingItem;
  span: BookingSpanInMonth;
  checkinCutIn: boolean;
  checkinMatePriorCheckout: boolean;
  turnoverIncoming: boolean;
  turnoverOutgoing: boolean;
  lane: number;
  nights: string;
  /** Stay continues past the last visible column — render a square trailing edge. */
  trailClipped?: boolean;
  onOpen?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `booking-${item.id}`,
    data: bookingItemToDragPayload(item),
  });
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const dragListeners = listeners as Record<string, unknown>;
  const mergedListeners = {
    ...dragListeners,
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      pointerStart.current = { x: e.clientX, y: e.clientY };
      (dragListeners.onPointerDown as ((ev: PointerEvent<HTMLDivElement>) => void) | undefined)?.(e);
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      (dragListeners.onPointerUp as ((ev: PointerEvent<HTMLDivElement>) => void) | undefined)?.(e);
      const down = pointerStart.current;
      pointerStart.current = null;
      if (!onOpen || !down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (dx * dx + dy * dy < 64) onOpen();
    },
    onPointerCancel: (e: PointerEvent<HTMLDivElement>) => {
      pointerStart.current = null;
      (dragListeners.onPointerCancel as ((ev: PointerEvent<HTMLDivElement>) => void) | undefined)?.(e);
    },
  };
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: 0.85,
      }
    : undefined;
  const channelClass =
    item.channel === "airbnb"
      ? "ops-booking-channel-airbnb"
      : item.channel === "booking"
        ? "ops-booking-channel-booking"
        : "ops-booking-channel-direct";

  const { start, endExclusive, barStart, layoutEndExclusive, checkoutDayInMonth } = span;
  const nightCount = endExclusive - start;
  const showCheckoutNib = checkoutDayInMonth != null;
  const checkoutDayFrac = 0.2;
  const innerCols = Math.max(1, layoutEndExclusive - barStart);
  const checkoutInnerCol =
    checkoutDayInMonth != null ? checkoutDayInMonth - barStart + 1 : null;

  const useMateLayout = checkinCutIn && checkinMatePriorCheckout && nightCount >= 1;

  const turnoverTrapezoid =
    turnoverIncoming ? " ops-timeline-booking-main--checkin-mate-turnover" : "";

  let mainClass = `ops-timeline-booking ops-timeline-booking-main ${channelClass}`;
  if (nightCount > 0 && !useMateLayout) {
    if (checkinCutIn && checkinMatePriorCheckout) {
      mainClass += " ops-timeline-booking-main--checkin-cut";
      mainClass += turnoverTrapezoid;
    }
    mainClass += showCheckoutNib
      ? " ops-timeline-booking-main--before-checkout-nib"
      : " ops-timeline-booking-main--nights-only";
  }
  const trailSuffix = trailClipped ? " ops-timeline-booking-main--trail-clipped" : "";
  if (trailClipped) mainClass += trailSuffix;

  const mainBody = (
    <>
      <span className="ops-timeline-booking-name ops-name-with-logo">
        <ChannelLogo channel={item.channel} className="ops-channel-logo" />
        <span>{item.guestName}</span>
      </span>
      <span className="ops-timeline-booking-meta">{nights}</span>
    </>
  );

  const baseMain = `ops-timeline-booking ops-timeline-booking-main ${channelClass}${trailSuffix}`;

  const inner = (
    <>
      {nightCount > 0 && !useMateLayout ? (
        <div className={mainClass} style={{ gridColumn: `1 / span ${nightCount}` }}>
          {mainBody}
        </div>
      ) : null}
      {nightCount > 0 && useMateLayout && nightCount === 1 ? (
        <div
          className="ops-timeline-mate-split"
          style={{
            gridColumn: "1 / 2",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 4fr)",
            alignItems: "stretch",
          }}
        >
          <div className="ops-timeline-mate-spacer" aria-hidden />
          <div
            className={`${baseMain} ops-timeline-booking-main--checkin-mate${turnoverTrapezoid} ${showCheckoutNib ? "ops-timeline-booking-main--before-checkout-nib" : "ops-timeline-booking-main--nights-only"}`}
          >
            {mainBody}
          </div>
        </div>
      ) : null}
      {nightCount > 1 && useMateLayout ? (
        <>
          <div
            className="ops-timeline-mate-split"
            style={{
              gridColumn: "1 / 2",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 4fr)",
              alignItems: "stretch",
            }}
          >
            <div className="ops-timeline-mate-spacer" aria-hidden />
            <div
              className={`${baseMain} ops-timeline-booking-main--mate-bridge ops-timeline-booking-main--checkin-mate${turnoverTrapezoid}`}
              aria-hidden
            />
          </div>
          <div
            className={`${baseMain} ops-timeline-booking-main--after-mate-bridge ${showCheckoutNib ? "ops-timeline-booking-main--before-checkout-nib" : "ops-timeline-booking-main--nights-only"}`}
            style={{ gridColumn: `2 / span ${nightCount - 1}` }}
          >
            {mainBody}
          </div>
        </>
      ) : null}
      {showCheckoutNib && checkoutInnerCol != null ? (
        <div
          className={`ops-timeline-booking ops-timeline-booking-checkout-day-nib ${channelClass}`}
          style={{
            gridColumn: `${checkoutInnerCol} / ${checkoutInnerCol + 1}`,
            width: `${checkoutDayFrac * 100}%`,
            justifySelf: "start",
          }}
          aria-hidden={true}
        />
      ) : null}
    </>
  );

  return (
    <div
      ref={setNodeRef}
      className={`ops-timeline-booking-wrap ${channelClass}`}
      data-turnover-in={turnoverIncoming ? "true" : undefined}
      data-turnover-out={turnoverOutgoing ? "true" : undefined}
      data-testid={`ops-booking-card-${item.id}`}
      title={item.guestName}
      style={{
        ...style,
        gridColumn: `${barStart} / ${layoutEndExclusive}`,
        gridRow: `${lane + 1}`,
        display: "grid",
        gridTemplateColumns: `repeat(${innerCols}, minmax(0, 1fr))`,
        alignItems: "stretch",
      }}
      {...mergedListeners}
      {...attributes}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.();
        }
      }}
      tabIndex={onOpen ? 0 : undefined}
    >
      {inner}
    </div>
  );
}

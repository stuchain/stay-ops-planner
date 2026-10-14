"use client";

import { useDraggable } from "@dnd-kit/core";
import { motion as m, useReducedMotion, type MotionStyle } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { memo, type CSSProperties } from "react";
import { useOnline } from "@/api/online";
import { useCanChange } from "@/features/shell/role";
import type { CalendarBooking } from "@/api/types";
import type { IsoDate } from "@stay-ops/domain";
import { BookingBar } from "@/ui/BookingBar";
import { formatMoney, type UiLocale } from "@/ui/format";
import { motion } from "@/ui/tokens";
import { barName } from "./barName";

export type DraggableBarProps = {
  booking: CalendarBooking;
  selected: boolean;
  needsRoom?: boolean;
  /** See BookingBar: the dates in place of the status, for the tray. */
  showDates?: boolean;
  /** See BookingBar: keeps the name in view on long stays. */
  stickyLeft?: number;
  style?: CSSProperties;
  className?: string;
  onOpen: (bookingId: string) => void;
  /**
   * One apartment's part of a stay that changed apartment mid-way: the bar shows only these nights and dragging it
   * moves only them. Left out, the bar is the whole stay.
   */
  piece?: BarPiece | undefined;
};

export type BarPiece = {
  start: IsoDate;
  end: IsoDate;
  /** Position among the stay's pieces and how many there are. */
  index: number;
  count: number;
  /** The apartment of the piece before, for "↳ από Helios". */
  fromRoom?: string | undefined;
  /** Being moved: drawn faded until it is placed. */
  lifted?: boolean;
};

/** What a bar carries while dragged: the booking and the nights that move. */
export type DragData = { bookingId: string; from?: IsoDate; to?: IsoDate };

function shallowEqual(a: object | undefined, b: object | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a) as (keyof typeof a)[];
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/**
 * A booking bar that opens the panel on click and can be dragged onto an apartment row. Memoised (style compared
 * by value), so redrawing the calendar while scrolling only renders the bars that came into view.
 */
export const DraggableBar = memo(DraggableBarInner, (prev, next) => {
  const { style: ps, ...pr } = prev;
  const { style: ns, ...nr } = next;
  const { piece: pp, ...prRest } = pr;
  const { piece: np, ...nrRest } = nr;
  return shallowEqual(prRest, nrRest) && shallowEqual(pp, np) && shallowEqual(ps, ns);
});

function DraggableBarInner({
  booking,
  selected,
  needsRoom = false,
  showDates = false,
  stickyLeft,
  style,
  className,
  onOpen,
  piece,
}: DraggableBarProps) {
  const t = useTranslations("common");
  const tCalendar = useTranslations("calendar");
  const locale = useLocale() as UiLocale;
  const pending = booking.status === "pending";
  const guest = booking.guestName ?? t("noName");
  const online = useOnline();
  const canChange = useCanChange();
  const priceDetail =
    booking.nightlyCents === undefined
      ? undefined
      : tCalendar("perNight", { price: formatMoney(booking.nightlyCents, locale) });
  // The bar glides to its new row (shared layoutId across rows); off when the person asks for less motion.
  const reduceMotion = useReducedMotion();
  const split = piece !== undefined && piece.count > 1;
  const dragData: DragData =
    split && piece ? { bookingId: booking.id, from: piece.start, to: piece.end } : { bookingId: booking.id };
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: split && piece ? `booking:${booking.id}:${piece.index}` : `booking:${booking.id}`,
    data: dragData,
    disabled: pending || !online || !canChange || Boolean(piece?.lifted),
  });
  // Dragging is a mouse shortcut. Keyboard users open the panel with Enter or Space and
  // choose the apartment there, so dnd-kit's keyboard attributes are not used.
  return (
    <m.div
      ref={setNodeRef}
      data-booking-id={booking.id}
      {...listeners}
      {...(style ? { style: style as MotionStyle } : {})}
      className={className}
      {...(reduceMotion
        ? {}
        : {
            layout: "position" as const,
            layoutId: split && piece && piece.index > 0 ? `bar:${booking.id}:${piece.index}` : `bar:${booking.id}`,
            transition: { duration: motion.layoutMs / 1000, ease: [0.2, 0, 0, 1] as const },
          })}
    >
      <BookingBar
        guest={guest}
        shownGuest={barName(guest, typeof style?.width === "number" ? style.width : undefined)}
        checkin={piece?.start ?? booking.checkin}
        checkout={piece?.end ?? booking.checkout}
        channel={booking.channel}
        selected={selected}
        joinedBefore={split && piece ? piece.index > 0 : false}
        joinedAfter={split && piece ? piece.index < piece.count - 1 : false}
        fromRoom={split ? piece?.fromRoom : undefined}
        lifted={piece?.lifted ?? false}
        dragging={isDragging}
        pending={pending}
        needsRoom={needsRoom && !pending}
        people={booking.partySize}
        detail={priceDetail}
        stickyLeft={stickyLeft}
        showDates={showDates}
        className="w-full"
        onClick={() => onOpen(booking.id)}
      />
    </m.div>
  );
}

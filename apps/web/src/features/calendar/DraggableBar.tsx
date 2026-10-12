"use client";

import { useDraggable } from "@dnd-kit/core";
import { motion as m, useReducedMotion, type MotionStyle } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { memo, type CSSProperties } from "react";
import { useOnline } from "@/api/online";
import { useCanChange } from "@/features/shell/role";
import type { CalendarBooking } from "@/api/types";
import { BookingBar } from "@/ui/BookingBar";
import { formatMoney, type UiLocale } from "@/ui/format";
import { motion } from "@/ui/tokens";

export type DraggableBarProps = {
  booking: CalendarBooking;
  selected: boolean;
  needsRoom?: boolean;
  /** See BookingBar: keeps the name in view on long stays. */
  stickyLeft?: number;
  style?: CSSProperties;
  className?: string;
  onOpen: (bookingId: string) => void;
};

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
  return shallowEqual(pr, nr) && shallowEqual(ps, ns);
});

function DraggableBarInner({
  booking,
  selected,
  needsRoom = false,
  stickyLeft,
  style,
  className,
  onOpen,
}: DraggableBarProps) {
  const t = useTranslations("common");
  const tCalendar = useTranslations("calendar");
  const locale = useLocale() as UiLocale;
  const pending = booking.status === "pending";
  const online = useOnline();
  const canChange = useCanChange();
  const priceDetail =
    booking.nightlyCents === undefined
      ? undefined
      : tCalendar("perNight", { price: formatMoney(booking.nightlyCents, locale) });
  // The bar glides to its new row (shared layoutId across rows); off when the person asks for less motion.
  const reduceMotion = useReducedMotion();
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `booking:${booking.id}`,
    data: { bookingId: booking.id },
    disabled: pending || !online || !canChange,
  });
  // Dragging is a mouse shortcut. Keyboard users open the panel with Enter or Space and
  // choose the apartment there, so dnd-kit's keyboard attributes are not used.
  return (
    <m.div
      ref={setNodeRef}
      {...listeners}
      {...(style ? { style: style as MotionStyle } : {})}
      className={className}
      {...(reduceMotion
        ? {}
        : {
            layout: "position" as const,
            layoutId: `bar:${booking.id}`,
            transition: { duration: motion.layoutMs / 1000, ease: [0.2, 0, 0, 1] as const },
          })}
    >
      <BookingBar
        guest={booking.guestName ?? t("noName")}
        checkin={booking.checkin}
        checkout={booking.checkout}
        channel={booking.channel}
        selected={selected}
        dragging={isDragging}
        pending={pending}
        needsRoom={needsRoom && !pending}
        detail={priceDetail}
        stickyLeft={stickyLeft}
        className="w-full"
        onClick={() => onOpen(booking.id)}
      />
    </m.div>
  );
}

import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { IsoDate } from "@stay-ops/domain";
import { cn } from "@/ui/cn";
import { formatRange, nightsBetween } from "@/ui/format";

export type BookingChannel = "airbnb" | "booking" | "direct" | "other";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "color" | "draggable"> & {
  guest: string;
  /** The name written on the bar when it should be shorter than `guest` (the label and tooltip keep `guest`). */
  shownGuest?: string | undefined;
  checkin: IsoDate;
  checkout: IsoDate;
  /** Sets the bar's colour and logo: Airbnb red, Booking.com blue, everything else Heaven's Door yellow. */
  channel: BookingChannel;
  selected?: boolean;
  dragging?: boolean;
  /** Greyed and not draggable until confirmed. Dragging itself is wired by the caller (dnd-kit), not native drag. */
  pending?: boolean;
  /** No apartment yet (amber). */
  needsRoom?: boolean;
  pendingLabel?: string;
  needsRoomLabel?: string;
  channelLabels?: Partial<Record<BookingChannel, string>>;
  /** Extra text after the nights, such as the Dev mode price per night. */
  detail?: string | undefined;
  /**
   * Keeps the logo and name this far from the left of the scrolling area while the bar's start is scrolled out
   * of view (the calendar passes the apartment column's width), so a long stay still shows whose it is.
   */
  stickyLeft?: number | undefined;
  /**
   * Writes the dates on the bar ("Τρ 12 – Τρ 19 Μαΐ · 7 νύχτες") in place of "Χρειάζεται διαμέρισμα", for bars that
   * sit outside the timeline (the tray), where nothing else shows when the stay is. A pending stay still says so.
   */
  showDates?: boolean;
};

/** Bar colours per channel; the same in light and dark mode so a channel always looks the same. */
export const CHANNEL_STYLE = {
  airbnb: "bg-[#D93B41] text-white",
  booking: "bg-[#1A5DB4] text-white",
  own: "bg-[#FFE38A] text-[#3D3200] ring-1 ring-inset ring-[#E2BE4A]",
} as const;

export function channelLook(channel: BookingChannel): keyof typeof CHANNEL_STYLE {
  return channel === "airbnb" || channel === "booking" ? channel : "own";
}

/** Airbnb's mark (Simple Icons, CC0). */
const AIRBNB_PATH =
  "M12.001 18.275c-1.353-1.697-2.148-3.184-2.413-4.457-.263-1.027-.16-1.848.291-2.465.477-.71 1.188-1.056 2.121-1.056s1.643.345 2.12 1.063c.446.61.558 1.432.286 2.465-.291 1.298-1.085 2.785-2.412 4.458zm9.601 1.14c-.185 1.246-1.034 2.28-2.2 2.783-2.253.98-4.483-.583-6.392-2.704 3.157-3.951 3.74-7.028 2.385-9.018-.795-1.14-1.933-1.695-3.394-1.695-2.944 0-4.563 2.49-3.927 5.382.37 1.565 1.352 3.343 2.917 5.332-.98 1.085-1.91 1.856-2.732 2.333-.636.344-1.245.558-1.828.609-2.679.399-4.778-2.2-3.825-4.88.132-.345.395-.98.845-1.961l.025-.053c1.464-3.178 3.242-6.79 5.285-10.795l.053-.132.58-1.116c.45-.822.635-1.19 1.351-1.643.346-.21.77-.315 1.246-.315.954 0 1.698.558 2.016 1.007.158.239.345.557.582.953l.558 1.089.08.159c2.041 4.004 3.821 7.608 5.279 10.794l.026.025.533 1.22.318.764c.243.613.294 1.222.213 1.858zm1.22-2.39c-.186-.583-.505-1.271-.9-2.094v-.03c-1.889-4.006-3.642-7.608-5.307-10.844l-.111-.163C15.317 1.461 14.468 0 12.001 0c-2.44 0-3.476 1.695-4.535 3.898l-.081.16c-1.669 3.236-3.421 6.843-5.303 10.847v.053l-.559 1.22c-.21.504-.317.768-.345.847C-.172 20.74 2.611 24 5.98 24c.027 0 .132 0 .265-.027h.372c1.75-.213 3.554-1.325 5.384-3.317 1.829 1.989 3.635 3.104 5.382 3.317h.372c.133.027.239.027.265.027 3.37.003 6.152-3.261 4.802-6.975z";

/** The channel's logo on a white tile: Airbnb, Booking.com, or the Heaven's Door sun for everything else. */
function ChannelLogo({ channel, label, muted }: { channel: BookingChannel; label: string; muted: boolean }) {
  const look = channelLook(channel);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "flex size-7 flex-none items-center justify-center overflow-hidden rounded-sm bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
        muted && "opacity-60 grayscale",
      )}
    >
      {look === "airbnb" ? (
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
          <path d={AIRBNB_PATH} fill="#FF5A5F" />
        </svg>
      ) : null}
      {look === "booking" ? (
        <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true">
          <rect width="24" height="24" fill="#003580" />
          <text x="5" y="18" fill="#fff" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="17">
            B
          </text>
          <circle cx="18.2" cy="16.4" r="2" fill="#009FE3" />
        </svg>
      ) : null}
      {look === "own" ? (
        // eslint-disable-next-line @next/next/no-img-element -- a 28px static logo; next/image adds nothing here.
        <img src="/brand/heavens-door-sun.png" alt="" className="size-[22px]" />
      ) : null}
    </span>
  );
}

/** A 56px booking bar. Position it in the track through `style` / `className`. */
export function BookingBar({
  guest,
  shownGuest,
  checkin,
  checkout,
  channel,
  selected = false,
  dragging = false,
  pending = false,
  needsRoom = false,
  pendingLabel,
  needsRoomLabel,
  channelLabels,
  detail,
  stickyLeft,
  showDates = false,
  className,
  style,
  type = "button",
  ...rest
}: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const channelLabel = channelLabels?.[channel] ?? t(`channel.${channel}`);
  const range = formatRange(checkin, checkout, locale);
  const nights = t("common.nights", { count: nightsBetween(checkin, checkout) });
  const status = pending
    ? (pendingLabel ?? t("bookingStatus.pending"))
    : needsRoom
      ? (needsRoomLabel ?? t("bookingStatus.needsRoom"))
      : null;
  const accessibleName = [guest, range, nights, status].filter(Boolean).join(", ");
  const draggable = !pending;

  return (
    <button
      {...rest}
      type={type}
      data-draggable={draggable}
      aria-label={accessibleName}
      aria-pressed={selected}
      title={`${accessibleName} · ${channelLabel}`}
      data-state={pending ? "pending" : needsRoom ? "needs-room" : "default"}
      style={style as CSSProperties}
      data-channel={channelLook(channel)}
      className={cn(
        "flex h-14 min-w-0 items-center overflow-clip rounded-sm px-3 text-left transition-[box-shadow,opacity] select-none",
        pending
          ? "border-2 border-dashed border-text-muted bg-surface-muted text-text-muted"
          : needsRoom
            ? "border-2 border-warning bg-warning-soft text-warning-text"
            : cn(CHANNEL_STYLE[channelLook(channel)], "shadow-card"),
        draggable && "cursor-grab",
        selected && "z-10 shadow-[0_0_0_3px_var(--so-surface),0_0_0_6px_var(--so-accent)]",
        dragging && "opacity-35",
        className,
      )}
    >
      {/* overflow-clip (not hidden) on the bar lets this stick to the scrolling area. */}
      <span
        className={cn("flex min-w-0 items-center gap-2", stickyLeft !== undefined && "sticky")}
        style={stickyLeft !== undefined ? { left: stickyLeft } : undefined}
      >
        <ChannelLogo channel={channel} label={channelLabel} muted={pending || needsRoom} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-bold">{shownGuest ?? guest}</span>
          <span className="truncate text-xs">
            {(showDates ? [range, nights, pending ? status : null, detail] : [nights, status, detail])
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </span>
    </button>
  );
}

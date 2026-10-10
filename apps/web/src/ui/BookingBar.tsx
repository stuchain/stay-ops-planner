import { Globe, Handshake } from "lucide-react";
import type { ButtonHTMLAttributes, CSSProperties } from "react";
import type { IsoDate } from "@stay-ops/domain";
import { cn } from "@/ui/cn";
import { formatNights, formatRange, nightsBetween } from "@/ui/format";

export type BookingChannel = "airbnb" | "booking" | "direct" | "other";

const CHANNEL_LABELS: Record<BookingChannel, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  direct: "Απευθείας",
  other: "Άλλο κανάλι",
};

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "color" | "draggable"> & {
  guest: string;
  checkin: IsoDate;
  checkout: IsoDate;
  channel: BookingChannel;
  /** The apartment's fixed colour as a hex string. */
  color: string;
  selected?: boolean;
  dragging?: boolean;
  /** Greyed and not draggable until confirmed. Dragging itself is wired by the caller (dnd-kit), not native drag. */
  pending?: boolean;
  /** No apartment yet (amber). */
  needsRoom?: boolean;
  pendingLabel?: string;
  needsRoomLabel?: string;
  channelLabels?: Partial<Record<BookingChannel, string>>;
};

function ChannelIcon({ channel, label, muted }: { channel: BookingChannel; label: string; muted: boolean }) {
  const box = cn(
    "flex size-6 flex-none items-center justify-center rounded-[6px] text-xs font-bold",
    muted ? "bg-border/60" : "bg-white/25",
  );
  return (
    <span role="img" aria-label={label} title={label} className={box}>
      {channel === "airbnb" ? "A" : null}
      {channel === "booking" ? "B" : null}
      {channel === "direct" ? <Handshake size={16} strokeWidth={2} aria-hidden="true" /> : null}
      {channel === "other" ? <Globe size={16} strokeWidth={2} aria-hidden="true" /> : null}
    </span>
  );
}

/** A 56px booking bar. Position it in the track through `style` / `className`. */
export function BookingBar({
  guest,
  checkin,
  checkout,
  channel,
  color,
  selected = false,
  dragging = false,
  pending = false,
  needsRoom = false,
  pendingLabel = "Εκκρεμεί",
  needsRoomLabel = "Χρειάζεται διαμέρισμα",
  channelLabels,
  className,
  style,
  type = "button",
  ...rest
}: Props) {
  const channelLabel = { ...CHANNEL_LABELS, ...channelLabels }[channel];
  const range = formatRange(checkin, checkout);
  const nights = formatNights(nightsBetween(checkin, checkout));
  const status = pending ? pendingLabel : needsRoom ? needsRoomLabel : null;
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
      style={{ ...style, "--apt": color } as CSSProperties}
      className={cn(
        "flex h-14 min-w-0 items-center gap-2 overflow-hidden rounded-[10px] px-3 text-left transition-[box-shadow,opacity] select-none",
        pending
          ? "border-2 border-dashed border-text-muted bg-surface-muted text-text-muted"
          : needsRoom
            ? "border-2 border-warning bg-warning-soft text-warning-text"
            : "bg-[var(--apt)] text-white shadow-[0_1px_2px_rgba(0,0,0,0.15)]",
        draggable && "cursor-grab",
        selected && "z-10 shadow-[0_0_0_3px_var(--so-surface),0_0_0_6px_var(--so-accent)]",
        dragging && "opacity-35",
        className,
      )}
    >
      <ChannelIcon channel={channel} label={channelLabel} muted={pending || needsRoom} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-bold">{guest}</span>
        <span className="truncate text-xs">{status ? `${nights} · ${status}` : nights}</span>
      </span>
    </button>
  );
}

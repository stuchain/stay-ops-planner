import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/ui/cn";
import { ApartmentChip } from "@/ui/ApartmentChip";

type Props = {
  name: string;
  /** Maximum number of guests. */
  capacity: number;
  inactive?: boolean;
  /** While a booking is selected or dragged: can it go into this apartment? */
  dropState?: "free" | "busy" | null;
  /** Who is in the apartment, shown when `dropState` is "busy". */
  busyGuest?: string;
  capacityLabel?: (capacity: number) => string;
  freeLabel?: string;
  busyLabel?: string;
  inactiveLabel?: string;
  /** The day track (cells and booking bars). */
  children?: ReactNode;
  className?: string;
};

/** One calendar row: sticky label cell on the left, the day track on the right. */
export function ApartmentRow({
  name,
  capacity,
  inactive = false,
  dropState = null,
  busyGuest,
  capacityLabel,
  freeLabel,
  busyLabel,
  inactiveLabel,
  children,
  className,
}: Props) {
  const t = useTranslations();
  const free = !inactive && dropState === "free";
  const busy = !inactive && dropState === "busy";
  return (
    <div
      role="group"
      aria-label={name}
      className={cn("relative flex h-row border-b border-border bg-surface", inactive && "bg-surface-muted", className)}
    >
      <div
        className={cn(
          "sticky left-0 z-10 flex w-52 flex-none flex-col justify-center gap-1 border-r border-border px-4",
          free ? "bg-success-soft" : "bg-surface",
          (busy || inactive) && "bg-surface-muted",
          inactive && "text-text-muted",
        )}
      >
        <ApartmentChip
          name={name}
          inactive={inactive}
          inactiveLabel={inactiveLabel ?? t("ui.inactive")}
          className="self-start"
        />
        <span className="text-xs text-text-muted">
          {capacityLabel ? capacityLabel(capacity) : t("common.upToPeople", { count: capacity })}
        </span>
        {free ? <span className="text-xs font-semibold text-success-text">{freeLabel ?? t("ui.free")}</span> : null}
        {busy ? (
          <span className="truncate text-xs font-semibold text-text-muted">
            {busyLabel !== undefined
              ? `${busyLabel}${busyGuest ? `: ${busyGuest}` : ""}`
              : busyGuest
                ? t("ui.busyBy", { guest: busyGuest })
                : t("ui.busy")}
          </span>
        ) : null}
      </div>
      <div className={cn("relative min-w-0 flex-1", inactive && "opacity-60")}>{children}</div>
    </div>
  );
}

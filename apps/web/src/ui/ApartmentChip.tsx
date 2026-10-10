import type { CSSProperties } from "react";
import { cn } from "@/ui/cn";

type Props = {
  name: string;
  /** The apartment's fixed colour as a hex string. */
  color: string;
  inactive?: boolean;
  inactiveLabel?: string;
  className?: string;
};

/** Small pill with the apartment colour dot and its name. */
export function ApartmentChip({ name, color, inactive = false, inactiveLabel = "Απενεργοποιημένο", className }: Props) {
  return (
    <span
      style={{ "--apt": color } as CSSProperties}
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border border-border bg-surface-muted py-1 pr-3 pl-2 text-sm font-semibold whitespace-nowrap",
        inactive ? "text-text-muted" : "text-text",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-3.5 shrink-0 rounded-[4px]", inactive ? "bg-border" : "bg-[var(--apt)]")}
      />
      <span>{name}</span>
      {inactive ? <span className="text-xs font-normal">· {inactiveLabel}</span> : null}
    </span>
  );
}

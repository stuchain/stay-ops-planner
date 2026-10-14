import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/ui/cn";
import { apartmentColor } from "@/ui/apartmentColor";

type Props = {
  name: string;
  /** The apartment's stored colour (hex); missing means no colour. Drawn through `apartmentColor`. */
  color: string | null | undefined;
  inactive?: boolean;
  inactiveLabel?: string;
  className?: string;
};

/** Small pill with the apartment colour dot and its name. */
export function ApartmentChip({ name, color, inactive = false, inactiveLabel, className }: Props) {
  const t = useTranslations("ui");
  return (
    <span
      style={{ "--apt": apartmentColor(color) } as CSSProperties}
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border border-border bg-surface-muted py-1 pr-3 pl-2 text-sm font-semibold whitespace-nowrap",
        inactive ? "text-text-muted" : "text-text",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-3.5 shrink-0 rounded-xs", inactive ? "bg-border" : "bg-[var(--apt)]")}
      />
      <span>{name}</span>
      {inactive ? <span className="text-xs font-normal">· {inactiveLabel ?? t("inactive")}</span> : null}
    </span>
  );
}

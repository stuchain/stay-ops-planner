import { useTranslations } from "next-intl";
import { cn } from "@/ui/cn";

type Props = {
  name: string;
  inactive?: boolean;
  inactiveLabel?: string;
  className?: string;
};

/** Small pill with the apartment name. Apartments have no colours of their own. */
export function ApartmentChip({ name, inactive = false, inactiveLabel, className }: Props) {
  const t = useTranslations("ui");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border border-border bg-surface-muted px-3 py-1 text-sm font-semibold whitespace-nowrap",
        inactive ? "text-text-muted" : "text-text",
        className,
      )}
    >
      <span>{name}</span>
      {inactive ? <span className="text-xs font-normal">· {inactiveLabel ?? t("inactive")}</span> : null}
    </span>
  );
}

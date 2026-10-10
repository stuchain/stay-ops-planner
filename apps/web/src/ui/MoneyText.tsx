import { cn } from "@/ui/cn";
import { formatMoney, type UiLocale } from "@/ui/format";

type Props = {
  /** Integer cents. */
  cents: number;
  locale?: UiLocale;
  className?: string;
};

/** An amount from integer cents, e.g. "1.250 €". */
export function MoneyText({ cents, locale = "el", className }: Props) {
  return <span className={cn("whitespace-nowrap tabular-nums", className)}>{formatMoney(cents, locale)}</span>;
}

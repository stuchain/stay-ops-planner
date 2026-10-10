import { useLocale } from "next-intl";
import { cn } from "@/ui/cn";
import { formatMoney, type UiLocale } from "@/ui/format";

type Props = {
  /** Integer cents. */
  cents: number;
  /** Defaults to the user's locale. */
  locale?: UiLocale;
  className?: string;
};

/** An amount from integer cents, e.g. "1.250 €". */
export function MoneyText({ cents, locale: localeProp, className }: Props) {
  const userLocale = useLocale();
  const locale = localeProp ?? userLocale;
  return <span className={cn("whitespace-nowrap tabular-nums", className)}>{formatMoney(cents, locale)}</span>;
}

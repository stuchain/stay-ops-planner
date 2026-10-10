import type { IsoDate } from "@stay-ops/domain";
import { cn } from "@/ui/cn";
import { formatDay, formatNights, formatRange, nightsBetween, type UiLocale } from "@/ui/format";

type Props = {
  /** A single day, or the start of a range. */
  date: IsoDate;
  /** When given, renders a range "from – to". */
  to?: IsoDate;
  withYear?: boolean;
  /** Appends the number of nights to a range. */
  showNights?: boolean;
  locale?: UiLocale;
  className?: string;
};

/** A date or date range in the app's short form, as a semantic <time>. */
export function DateText({ date, to, withYear = false, showNights = false, locale = "el", className }: Props) {
  if (!to) {
    return (
      <time dateTime={date} className={className}>
        {formatDay(date, locale, withYear)}
      </time>
    );
  }
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <time dateTime={`${date}/${to}`}>{formatRange(date, to, locale, withYear)}</time>
      {showNights ? ` · ${formatNights(nightsBetween(date, to), locale)}` : null}
    </span>
  );
}

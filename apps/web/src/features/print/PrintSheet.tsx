"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { addDays, type IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { CalendarBooking, CalendarRangeData, CalendarRoom } from "@/api/types";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { DateText } from "@/ui/DateText";
import { ErrorState } from "@/ui/ErrorState";
import { Skeleton } from "@/ui/Skeleton";
import {
  buildMonth,
  buildWeek,
  isPending,
  mondayOf,
  sheetEnd,
  shiftSheet,
  sheetStart,
  type CellEntry,
  type MonthItem,
  type PrintView,
} from "./layout";

/** Page setup and big black-on-white type for the paper copy; the app shell around the sheet is hidden. */
const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  html, body { background: #fff !important; }
  [data-sonner-toaster] { display: none !important; }
  .print-sheet { font-size: 14pt; line-height: 1.3; padding: 0 !important; }
  .print-sheet, .print-sheet * { color: #000 !important; background-color: transparent !important; box-shadow: none !important; }
  .print-sheet .swatch { background-color: var(--swatch) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-sheet thead { display: table-header-group; }
  .print-sheet tr, .print-sheet li { break-inside: avoid; }
  .print-sheet h2 { break-after: avoid; }
}
`;

type Data = Pick<CalendarRangeData, "rooms" | "bookings" | "blocks">;

function Swatch({ room }: { room: CalendarRoom }) {
  return (
    <span
      aria-hidden="true"
      className="swatch inline-block size-4 shrink-0 border border-black"
      style={{ ["--swatch" as string]: room.color ?? "#fff", backgroundColor: room.color ?? "#fff" }}
    />
  );
}

function RoomName({ room }: { room: CalendarRoom }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold">
      <Swatch room={room} />
      {room.name}
    </span>
  );
}

/** "Maria P." in bold and, when known, "2 άτομα" after it. */
function Guest({ booking }: { booking: CalendarBooking }) {
  const common = useTranslations("common");
  const t = useTranslations("printSheet");
  const pending = isPending(booking);
  const people = booking.partySize === null ? null : common("people", { count: booking.partySize });
  const pendingText = t("pending");
  const noName = common("noName");
  return (
    <span className={cn("block", pending && "text-[#444] italic")}>
      <strong className="font-bold">{booking.guestName ?? noName}</strong>
      {people ? <span>{` · ${people}`}</span> : null}
      {pending ? <span className="font-bold">{` · ${pendingText}`}</span> : null}
    </span>
  );
}

function Entry({ entry }: { entry: CellEntry }) {
  const t = useTranslations("printSheet");
  const label = entry.kind === "departure" ? t("departure") : entry.arrival ? t("arrival") : null;
  return (
    <li className="border-t border-black/40 pt-1 first:border-t-0 first:pt-0">
      {label ? <span className="block font-bold uppercase">{label}</span> : null}
      <Guest booking={entry.booking} />
    </li>
  );
}

function WeekTable({ data, from }: { data: Data; from: IsoDate }) {
  const t = useTranslations("printSheet");
  const sheet = buildWeek(data, from);
  const closedText = t("closed");
  return (
    <table className="w-full table-fixed border-collapse border-2 border-black">
      <thead>
        <tr>
          <th scope="col" className="w-[13%] border border-black p-2 text-left">
            {t("apartment")}
          </th>
          {sheet.days.map((day) => (
            <th key={day} scope="col" className="border border-black p-2 text-left">
              <DateText date={day} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sheet.rows.map((row) => (
          <tr key={row.room.id}>
            <th scope="row" className="border border-black p-2 text-left align-top">
              <RoomName room={row.room} />
            </th>
            {row.cells.map((cell) => (
              <td key={cell.day} className="h-24 border border-black p-2 align-top">
                {cell.closed ? <p className="font-bold">{closedText}</p> : null}
                <ul className="flex flex-col gap-1">
                  {cell.entries.map((entry) => (
                    <Entry key={`${entry.kind}-${entry.booking.id}`} entry={entry} />
                  ))}
                </ul>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StayLine({ item }: { item: MonthItem }) {
  const common = useTranslations("common");
  const t = useTranslations("printSheet");
  const closedText = t("closed");
  return (
    <tr>
      <td className="w-[34%] border border-black p-2 align-top font-bold whitespace-nowrap">
        <DateText date={item.start} to={item.end} />
      </td>
      <td className="w-[14%] border border-black p-2 align-top">{common("nights", { count: item.nights })}</td>
      {item.kind === "stay" ? (
        <>
          <td className="border border-black p-2 align-top">
            <Guest booking={item.booking} />
          </td>
          <td className="w-[16%] border border-black p-2 align-top">
            {item.booking.partySize === null ? "" : common("people", { count: item.booking.partySize })}
          </td>
        </>
      ) : (
        <td colSpan={2} className="border border-black p-2 align-top font-bold">
          {closedText}
        </td>
      )}
    </tr>
  );
}

function MonthTables({ data, from }: { data: Data; from: IsoDate }) {
  const t = useTranslations("printSheet");
  const sheet = buildMonth(data, from);
  const emptyText = t("noStays");
  return (
    <div className="flex flex-col gap-4">
      {sheet.sections.map(({ room, items }) => (
        <section key={room.id} aria-label={room.name} className="flex flex-col gap-1">
          <h2 className="text-lg font-bold">
            <RoomName room={room} />
          </h2>
          {items.length === 0 ? (
            <p className="border border-black p-2">{emptyText}</p>
          ) : (
            <table className="w-full border-collapse border-2 border-black">
              <tbody>
                {items.map((item) => (
                  <StayLine key={item.kind === "stay" ? item.booking.id : item.block.id} item={item} />
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

function Unplaced({ bookings }: { bookings: CalendarBooking[] }) {
  const t = useTranslations("printSheet");
  const common = useTranslations("common");
  const noName = common("noName");
  return (
    <section aria-label={t("unplaced")} className="mt-6 flex flex-col gap-1">
      <h2 className="text-lg font-bold">{t("unplaced")}</h2>
      {bookings.length === 0 ? (
        <p>{t("noUnplaced")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {bookings.map((b) => (
            <li key={b.id} className={cn("border border-black p-2", isPending(b) && "text-[#444] italic")}>
              <strong className="font-bold">
                <DateText date={b.checkin} to={b.checkout} />
              </strong>
              {` · ${common("nights", { count: b.nights })} · `}
              <strong className="font-bold">{b.guestName ?? noName}</strong>
              {b.partySize === null ? null : ` · ${common("people", { count: b.partySize })}`}
              {isPending(b) ? <strong className="font-bold">{` · ${t("pending")}`}</strong> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type PrintSheetViewProps = {
  view: PrintView;
  from: IsoDate;
  data: Data;
  /** When the paper copy is printed; shown in the header. */
  printedAt: Date | null;
};

/** The sheet itself: header, table or lists, and the unplaced bookings. Pure: it only draws what it is given. */
export function PrintSheetView({ view, from, data, printedAt }: PrintSheetViewProps) {
  const t = useTranslations("printSheet");
  const format = useFormatter();
  const utc = (iso: IsoDate, options: { day?: "numeric"; month: "long"; year?: "numeric" }) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), { timeZone: "UTC", ...options });

  let title: string;
  if (view === "week") {
    const last = addDays(from, 6);
    const sameMonth = from.slice(0, 7) === last.slice(0, 7);
    const start = sameMonth ? String(Number(from.slice(8))) : utc(from, { day: "numeric", month: "long" });
    const end = utc(last, { day: "numeric", month: "long", year: "numeric" });
    title = t("weekTitle", { range: sameMonth ? `${start}–${end}` : `${start} – ${end}` });
  } else {
    title = utc(from, { month: "long", year: "numeric" });
  }
  const printed = printedAt ? format.dateTime(printedAt, { dateStyle: "medium", timeStyle: "short" }) : "";
  const unplaced = (view === "week" ? buildWeek(data, from) : buildMonth(data, from)).unplaced;

  return (
    <article className="print-sheet flex flex-col gap-4 bg-white p-6 text-black">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-black pb-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p>{printed ? t("printedAt", { when: printed }) : null}</p>
      </header>
      {view === "week" ? <WeekTable data={data} from={from} /> : <MonthTables data={data} from={from} />}
      <Unplaced bookings={unplaced} />
    </article>
  );
}

function NavLink({ href, children, current }: { href: string; children: ReactNode; current?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={current ? "true" : undefined}
      className={cn(
        buttonBase,
        current ? buttonVariants.primary : buttonVariants.secondary,
        buttonSizes.md,
        "no-underline",
      )}
    >
      {children}
    </Link>
  );
}

const sheetHref = (view: PrintView, from: IsoDate) => `/app/calendar/print?view=${view}&from=${from}`;

export type PrintSheetProps = { view: PrintView; from: IsoDate };

/** /app/calendar/print: a plain paper copy of one week or month, with a small toolbar that is not printed. */
export function PrintSheet({ view, from }: PrintSheetProps) {
  const t = useTranslations("printSheet");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const to = sheetEnd(view, from);
  const query = useQuery(trpc.calendar.range.queryOptions({ from, to }));
  const [printedAt, setPrintedAt] = useState<Date | null>(null);
  useEffect(() => {
    const stamp = () => setPrintedAt(new Date());
    stamp();
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, []);

  return (
    <div className="flex flex-col gap-4 p-8 max-[759px]:p-4 print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <NavLink href="/app/calendar">
          <ArrowLeft size={24} aria-hidden="true" />
          {t("back")}
        </NavLink>
        <NavLink href={sheetHref(view, shiftSheet(view, from, -1))}>{t("previous")}</NavLink>
        <NavLink href={sheetHref(view, shiftSheet(view, from, 1))}>{t("next")}</NavLink>
        <div role="group" aria-label={t("view")} className="border-border flex rounded-sm border">
          <NavLink href={sheetHref("week", mondayOf(from))} current={view === "week"}>
            {t("week")}
          </NavLink>
          <NavLink href={sheetHref("month", sheetStart("month", from))} current={view === "month"}>
            {t("month")}
          </NavLink>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className={cn(buttonBase, buttonVariants.primary, buttonSizes.lg, "ml-auto")}
        >
          <Printer size={24} aria-hidden="true" />
          {t("print")}
        </button>
      </div>
      {query.data ? (
        <PrintSheetView view={view} from={from} data={query.data} printedAt={printedAt} />
      ) : query.error ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <div role="status" aria-label={t("loading")} className="flex flex-col gap-3">
          <Skeleton variant="block" />
          <Skeleton variant="block" />
        </div>
      )}
    </div>
  );
}

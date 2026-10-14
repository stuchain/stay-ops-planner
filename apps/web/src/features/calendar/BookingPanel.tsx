"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, IdCard, LogOut } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import type { IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { BookingDetails, CalendarBooking, CalendarRoom, Suggestion } from "@/api/types";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { arrivalCardsHref } from "@/features/arrivalCards/ids";
import { useCanChange } from "@/features/shell/role";
import { Button, buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { DateText } from "@/ui/DateText";
import { ErrorState } from "@/ui/ErrorState";
import { formatDay, formatMoney, type UiLocale } from "@/ui/format";
import { SidePanel } from "@/ui/SidePanel";
import { Skeleton } from "@/ui/Skeleton";
import { BookingEdit } from "./BookingEdit";
import { BookingHistory } from "./BookingHistory";
import { BookingPrice } from "./BookingPrice";
import { GuestMessage } from "./GuestMessage";
import { GuestNotes } from "./GuestNotes";
import { PanelFold } from "./PanelFold";
import { recommendationText } from "./recommendation";
import { ReturningLines } from "./ReturningGuest";
import type { MoveRequest } from "./useMoveBooking";

const NEUTRAL = "#5B5852";

function noop() {}

export type BookingPanelProps = {
  booking: CalendarBooking | null;
  rooms: CalendarRoom[];
  today: IsoDate;
  /** Set when the server asked to confirm moving a guest who has arrived. */
  confirm: MoveRequest | null;
  moving: boolean;
  onMove: (request: MoveRequest) => void;
  onCancelConfirm: () => void;
  onClose: () => void;
  /** Tells the screen whether the edit form has unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
};

type T = ReturnType<typeof useTranslations<"booking">>;

export function busyText(t: T, s: Pick<Suggestion, "reasons" | "blockedByGuest">): string {
  if (s.reasons.includes("ROOM_INACTIVE")) return t("inactive");
  if (s.reasons.includes("ROOM_CLOSED")) return t("closedThoseDays");
  return s.blockedByGuest ? t("busyBy", { guest: s.blockedByGuest }) : t("busy");
}

/** The apartments to choose from, best first: the recommended one in green, booked ones greyed with who is there. */
function MoveButtons({
  booking,
  rooms,
  moving,
  onMove,
}: {
  booking: CalendarBooking;
  rooms: CalendarRoom[];
  moving: boolean;
  onMove: (request: MoveRequest) => void;
}) {
  const t = useTranslations("booking");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const suggestions = useQuery(trpc.booking.suggestions.queryOptions({ bookingId: booking.id }));
  if (suggestions.isPending) return <Skeleton variant="block" className="h-64" />;
  if (suggestions.error) {
    return <ErrorState message={errorText(suggestions.error)} onRetry={() => void suggestions.refetch()} />;
  }
  const current = booking.assignment?.roomId ?? null;
  return (
    <ul className="flex flex-col gap-2">
      {suggestions.data.map((s) => {
        const room = rooms.find((r) => r.id === s.roomId);
        if (!room) return null;
        const here = s.roomId === current;
        const choosable = s.available && !here;
        const best = s.recommended && choosable;
        const small = s.available && s.warnings.includes("OVER_CAPACITY") && room.capacity !== null;
        const note = here
          ? t("isHereNow")
          : !s.available
            ? busyText(t, s)
            : small
              ? t("smallRoom", { count: room.capacity! })
              : s.recommended
                ? recommendationText(t, s.reasons, booking.partySize)
                : t("free");
        return (
          <li key={s.roomId}>
            <button
              type="button"
              disabled={!choosable || moving}
              onClick={() => onMove({ booking, roomId: s.roomId })}
              aria-label={t("moveToAria", { room: room.name, note })}
              data-recommended={best || undefined}
              className={cn(
                "min-h-button rounded-sm flex w-full flex-wrap items-center gap-3 border px-4 py-2 text-left",
                "disabled:cursor-not-allowed",
                best ? "border-success bg-success-soft border-2" : "border-border bg-surface",
                !choosable && "bg-surface-muted text-text-muted opacity-70",
                choosable && !best && "hover:bg-surface-muted",
              )}
            >
              <ApartmentChip name={room.name} color={room.color ?? NEUTRAL} inactive={!room.isActive} />
              <span
                className={cn(
                  "text-sm min-w-[100px] flex-1",
                  small && !here && "text-warning-text font-semibold",
                  best && !small && "text-success-text font-semibold",
                )}
              >
                {note}
              </span>
              {choosable ? (
                <span
                  aria-hidden="true"
                  className={cn(buttonBase, buttonVariants[best ? "primary" : "secondary"], buttonSizes.md)}
                >
                  {t("here")}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "Στο Cosmos" with a small "Αλλαγή διαμερίσματος" that shows the apartment list and "Βγάλτε την". */
function PlacedIn({
  booking,
  rooms,
  roomName,
  moving,
  onMove,
}: {
  booking: CalendarBooking;
  rooms: CalendarRoom[];
  roomName: string;
  moving: boolean;
  onMove: (request: MoveRequest) => void;
}) {
  const t = useTranslations("booking");
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="move-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="move-title" className="text-lg font-semibold">
          {t("inRoom", { room: roomName })}
        </h3>
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls="move-list"
          onClick={() => setOpen(!open)}
          className="text-accent"
        >
          {t("changeApartment")}
          <ChevronDown size={20} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      <div id="move-list" hidden={!open} className={open ? "flex flex-col gap-3" : "hidden"}>
        {open ? (
          <>
            <MoveButtons booking={booking} rooms={rooms} moving={moving} onMove={onMove} />
            <Button
              variant="ghost"
              icon={LogOut}
              disabled={moving}
              onClick={() => onMove({ booking, roomId: null })}
              className="self-start"
            >
              {t("removeFromApartment")}
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** The one thing to do with this booking, right under its name: choose an apartment, or see which one it is in. */
function MainAction({
  booking,
  rooms,
  today,
  moving,
  onMove,
}: {
  booking: CalendarBooking;
  rooms: CalendarRoom[];
  today: IsoDate;
  moving: boolean;
  onMove: (request: MoveRequest) => void;
}) {
  const t = useTranslations("booking");
  const locale = useLocale();
  const canChange = useCanChange();
  const roomName = rooms.find((r) => r.id === booking.assignment?.roomId)?.name ?? "";
  const muted = "bg-surface-muted rounded-card text-text-muted p-4";

  if (booking.status === "pending") return <p className={muted}>{t("pendingNote")}</p>;
  if (!canChange || booking.checkout <= today) {
    if (booking.assignment) {
      return (
        <div className="flex flex-col gap-3">
          <h3 id="move-title" className="text-lg font-semibold">
            {t("inRoom", { room: roomName })}
          </h3>
          {canChange ? <p className={muted}>{t("endedNote", { date: formatDay(booking.checkout, locale) })}</p> : null}
        </div>
      );
    }
    if (!canChange) return <p className="text-lg font-semibold">{t("needsApartment")}</p>;
    return (
      <section aria-labelledby="move-title" className="flex flex-col gap-3">
        <h3 id="move-title" className="text-lg font-semibold">
          {t("whereStayed")}
        </h3>
        <p className="text-sm text-text-muted">{t("whereStayedNote", { date: formatDay(booking.checkout, locale) })}</p>
        <MoveButtons booking={booking} rooms={rooms} moving={moving} onMove={onMove} />
      </section>
    );
  }
  if (booking.assignment) {
    return <PlacedIn booking={booking} rooms={rooms} roomName={roomName} moving={moving} onMove={onMove} />;
  }
  return (
    <section aria-labelledby="move-title" className="flex flex-col gap-3">
      <h3 id="move-title" className="text-lg font-semibold">
        {t("whichApartment")}
      </h3>
      <MoveButtons booking={booking} rooms={rooms} moving={moving} onMove={onMove} />
    </section>
  );
}

/** Dates and nights, people and where it came from, as one line under the guest's name. */
function Facts({ booking }: { booking: CalendarBooking }) {
  const t = useTranslations();
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      <DateText date={booking.checkin} to={booking.checkout} showNights className="text-text font-semibold" />
      {booking.partySize !== null ? (
        <span className="text-text font-semibold">{t("common.people", { count: booking.partySize })}</span>
      ) : null}
      <span>
        {t.rich("booking.from", {
          channel: t(`channel.${booking.channel}`),
          b: (chunks) => <b className="text-text font-semibold">{chunks}</b>,
        })}
      </span>
    </span>
  );
}

/** "Τιμή · 900 €", or just "Τιμή" when Hosthub sent none. */
function priceLabel(t: T, price: BookingDetails["price"], locale: UiLocale, plain: string): string {
  return price ? t("priceRow", { price: formatMoney(price.totalCents, locale) }) : plain;
}

/** Everything under the main action, one closed row each. A booking's rows start closed when it is opened. */
function Folds({
  booking,
  rooms,
  details,
  onDirtyChange,
}: {
  booking: CalendarBooking;
  rooms: CalendarRoom[];
  details: BookingDetails | undefined;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useTranslations();
  const tBooking = useTranslations("booking");
  const locale = useLocale() as UiLocale;
  const canChange = useCanChange();
  const [editDirty, setEditDirty] = useState(false);
  const onEditDirty = useCallback(
    (dirty: boolean) => {
      setEditDirty(dirty);
      onDirtyChange(dirty);
    },
    [onDirtyChange],
  );
  const roomName = rooms.find((r) => r.id === booking.assignment?.roomId)?.name ?? null;
  const rowLink =
    "border-border text-text hover:bg-surface-muted min-h-button -mx-2 flex items-center gap-3 rounded-sm border-t px-2 font-semibold";
  return (
    <div className="border-border flex flex-col border-b">
      {details && canChange ? (
        <PanelFold label={t("booking.sendMessage")} testId="fold-message">
          <GuestMessage booking={booking} roomName={roomName} phone={details.phone} />
        </PanelFold>
      ) : null}
      {details && (canChange || details.guestNote) ? (
        <PanelFold label={t("guestNotes.title")} testId="fold-guest-note">
          <GuestNotes bookingId={booking.id} note={details.guestNote} />
        </PanelFold>
      ) : null}
      <Link href={arrivalCardsHref([booking.id])} target="_blank" className={rowLink}>
        <IdCard size={24} aria-hidden="true" />
        <span className="flex-1">{t("arrivalCards.open")}</span>
        <ExternalLink size={20} aria-hidden="true" className="text-text-muted" />
      </Link>
      {details && canChange ? (
        <PanelFold label={priceLabel(tBooking, details.price, locale, t("bookingEdit.priceTitle"))} testId="fold-price">
          <BookingPrice price={details.price} />
        </PanelFold>
      ) : null}
      {details ? (
        <PanelFold
          label={canChange ? t("booking.editDetails") : t("bookingEdit.title")}
          locked={editDirty}
          testId="fold-edit"
        >
          <BookingEdit booking={booking} details={details} onDirtyChange={onEditDirty} />
        </PanelFold>
      ) : (
        <Skeleton variant="block" className="my-2 h-12" />
      )}
      <PanelFold label={t("history.title")} testId="fold-history">
        <BookingHistory bookingId={booking.id} />
      </PanelFold>
    </div>
  );
}

/** Booking details and the apartment choice, beside the calendar. */
export function BookingPanel({
  booking,
  rooms,
  today,
  confirm,
  moving,
  onMove,
  onCancelConfirm,
  onClose,
  onDirtyChange = noop,
}: BookingPanelProps) {
  const t = useTranslations();
  const locale = useLocale();
  const trpc = useTRPC();
  const details = useQuery({
    ...trpc.booking.details.queryOptions({ bookingId: booking?.id ?? "" }),
    enabled: booking !== null,
  });
  const previous = useQuery({
    ...trpc.booking.previousStays.queryOptions({ bookingId: booking?.id ?? "" }),
    enabled: booking !== null,
  });
  const open = booking !== null;
  const roomName = (id: string | null | undefined) => rooms.find((r) => r.id === id)?.name ?? "";

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={booking?.guestName ?? t("booking.title")}
      {...(booking ? { description: <Facts booking={booking} /> } : {})}
    >
      {booking ? (
        <div className="flex flex-col gap-5">
          {previous.data ? <ReturningLines previous={previous.data} /> : null}

          {confirm && confirm.booking.id === booking.id ? (
            <div
              role="alertdialog"
              aria-labelledby="confirm-started"
              className="bg-warning-soft text-warning-text rounded-card p-4"
            >
              <p id="confirm-started" className="text-base mb-3 font-medium">
                {t("booking.confirmStarted", {
                  guest: booking.guestName ?? t("common.guest"),
                  room: roomName(booking.assignment?.roomId),
                  date: formatDay(booking.checkin, locale),
                })}{" "}
                {confirm.roomId === null
                  ? t("booking.confirmRemove")
                  : t("booking.confirmMove", { room: roomName(confirm.roomId) })}
              </p>
              <div className="flex gap-3">
                <Button
                  variant="primary"
                  size="lg"
                  loading={moving}
                  onClick={() => onMove({ ...confirm, confirmStarted: true })}
                >
                  {t("booking.confirmYes")}
                </Button>
                <Button size="lg" onClick={onCancelConfirm}>
                  {t("common.no")}
                </Button>
              </div>
            </div>
          ) : null}

          <MainAction
            key={`action-${booking.id}`}
            booking={booking}
            rooms={rooms}
            today={today}
            moving={moving}
            onMove={onMove}
          />

          <Folds
            key={`folds-${booking.id}`}
            booking={booking}
            rooms={rooms}
            details={details.data}
            onDirtyChange={onDirtyChange}
          />
        </div>
      ) : null}
    </SidePanel>
  );
}

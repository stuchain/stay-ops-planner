"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, IdCard, LogOut } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { CalendarBooking, CalendarRoom, Suggestion } from "@/api/types";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { arrivalCardsHref } from "@/features/arrivalCards/ids";
import { Button, buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { DateText } from "@/ui/DateText";
import { ErrorState } from "@/ui/ErrorState";
import { formatDay } from "@/ui/format";
import { SidePanel } from "@/ui/SidePanel";
import { Skeleton } from "@/ui/Skeleton";
import { BookingEdit } from "./BookingEdit";
import { BookingHistory } from "./BookingHistory";
import { BookingPrice } from "./BookingPrice";
import { GuestMessage } from "./GuestMessage";
import { GuestNotes } from "./GuestNotes";
import { recommendationText } from "./recommendation";
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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

type T = ReturnType<typeof useTranslations<"booking">>;

export function busyText(t: T, s: Pick<Suggestion, "reasons" | "blockedByGuest">): string {
  if (s.reasons.includes("ROOM_INACTIVE")) return t("inactive");
  if (s.reasons.includes("ROOM_CLOSED")) return t("closedThoseDays");
  return s.blockedByGuest ? t("busyBy", { guest: s.blockedByGuest }) : t("busy");
}

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
              disabled={here || !s.available || moving}
              onClick={() => onMove({ booking, roomId: s.roomId })}
              aria-label={t("moveToAria", { room: room.name, note })}
              className={cn(
                "min-h-button rounded-sm flex w-full items-center gap-3 border px-4 py-2 text-left",
                "disabled:cursor-not-allowed",
                s.recommended && !here ? "border-accent bg-accent-soft border-2" : "border-border bg-surface",
                (!s.available || here) && "bg-surface-muted text-text-muted",
                s.available && !here && "hover:bg-surface-muted",
              )}
            >
              <ApartmentChip name={room.name} color={room.color ?? NEUTRAL} inactive={!room.isActive} />
              <span
                className={cn(
                  "text-sm min-w-0 flex-1",
                  small && !here && "text-warning-text font-semibold",
                  s.recommended && !here && !small && "text-accent font-semibold",
                )}
              >
                {note}
              </span>
              {s.available && !here ? <ArrowRight size={24} strokeWidth={2} aria-hidden="true" /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Booking details and the "Μετακίνηση σε" buttons, beside the calendar. */
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
  const open = booking !== null;
  const roomName = (id: string | null | undefined) => rooms.find((r) => r.id === id)?.name ?? "";

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={booking?.guestName ?? t("booking.title")}
      {...(booking ? { description: <DateText date={booking.checkin} to={booking.checkout} showNights /> } : {})}
    >
      {booking ? (
        <div className="flex flex-col gap-6">
          <dl className="text-sm divide-border divide-y">
            <Detail label={t("booking.channel")}>{t(`channel.${booking.channel}`)}</Detail>
            <Detail label={t("booking.apartment")}>
              {booking.assignment ? roomName(booking.assignment.roomId) : t("booking.needsApartment")}
            </Detail>
          </dl>

          {details.data ? (
            <BookingEdit key={booking.id} booking={booking} details={details.data} onDirtyChange={onDirtyChange} />
          ) : details.isPending ? (
            <Skeleton variant="block" className="h-40" />
          ) : null}

          {details.data ? (
            <GuestNotes key={`notes-${booking.id}`} bookingId={booking.id} note={details.data.guestNote} />
          ) : null}

          <Link
            href={arrivalCardsHref([booking.id])}
            target="_blank"
            className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg, "self-start")}
          >
            <IdCard size={24} aria-hidden="true" />
            {t("arrivalCards.open")}
          </Link>

          {details.data ? (
            <GuestMessage
              key={`message-${booking.id}`}
              booking={booking}
              roomName={booking.assignment ? roomName(booking.assignment.roomId) : null}
              phone={details.data.phone}
            />
          ) : null}

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

          {booking.status === "pending" ? (
            <p className="bg-surface-muted rounded-card text-text-muted p-4">{t("booking.pendingNote")}</p>
          ) : booking.checkout <= today && booking.assignment ? (
            <p className="bg-surface-muted rounded-card text-text-muted p-4">
              {t("booking.endedNote", { date: formatDay(booking.checkout, locale) })}
            </p>
          ) : booking.checkout <= today ? (
            <section aria-labelledby="move-title" className="flex flex-col gap-3">
              <h3 id="move-title" className="text-base font-semibold">
                {t("booking.whereStayed")}
              </h3>
              <p className="text-sm text-text-muted">
                {t("booking.whereStayedNote", { date: formatDay(booking.checkout, locale) })}
              </p>
              <MoveButtons booking={booking} rooms={rooms} moving={moving} onMove={onMove} />
            </section>
          ) : (
            <section aria-labelledby="move-title" className="flex flex-col gap-3">
              <h3 id="move-title" className="text-base font-semibold">
                {t("booking.moveTo")}
              </h3>
              <MoveButtons booking={booking} rooms={rooms} moving={moving} onMove={onMove} />
              {booking.assignment ? (
                <Button
                  variant="ghost"
                  icon={LogOut}
                  disabled={moving}
                  onClick={() => onMove({ booking, roomId: null })}
                  className="self-start"
                >
                  {t("booking.removeFromApartment")}
                </Button>
              ) : null}
            </section>
          )}

          {details.data ? <BookingPrice price={details.data.price} /> : null}
          <BookingHistory bookingId={booking.id} />
        </div>
      ) : null}
    </SidePanel>
  );
}

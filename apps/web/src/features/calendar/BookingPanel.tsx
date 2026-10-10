"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, LogOut } from "lucide-react";
import type { IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { errorText } from "@/api/errors";
import type { CalendarBooking, CalendarRoom, Suggestion } from "@/api/types";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { DateText } from "@/ui/DateText";
import { ErrorState } from "@/ui/ErrorState";
import { formatDay } from "@/ui/format";
import { MoneyText } from "@/ui/MoneyText";
import { SidePanel } from "@/ui/SidePanel";
import { Skeleton } from "@/ui/Skeleton";
import { CHANNEL_EL, partyText, recommendationText, smallRoomText } from "./text";
import type { MoveRequest } from "./useMoveBooking";

const NEUTRAL = "#5B5852";

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
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function busyText(s: Suggestion): string {
  if (s.reasons.includes("ROOM_INACTIVE")) return "Απενεργοποιημένο";
  if (s.reasons.includes("ROOM_CLOSED")) return "Κλειστό εκείνες τις μέρες";
  return s.blockedByGuest ? `Κλεισμένο: ${s.blockedByGuest}` : "Κλεισμένο";
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
          ? "Είναι εδώ τώρα"
          : !s.available
            ? busyText(s)
            : small
              ? smallRoomText(room.capacity!)
              : s.recommended
                ? recommendationText(s.reasons, booking.partySize)
                : "Ελεύθερο";
        return (
          <li key={s.roomId}>
            <button
              type="button"
              disabled={here || !s.available || moving}
              onClick={() => onMove({ booking, roomId: s.roomId })}
              aria-label={`Μετακίνηση στο ${room.name}. ${note}`}
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
}: BookingPanelProps) {
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
      title={booking?.guestName ?? "Κράτηση"}
      {...(booking ? { description: <DateText date={booking.checkin} to={booking.checkout} showNights /> } : {})}
    >
      {booking ? (
        <div className="flex flex-col gap-6">
          <dl className="text-sm divide-border divide-y">
            <Detail label="Άτομα">{partyText(booking.partySize)}</Detail>
            <Detail label="Κανάλι">{CHANNEL_EL[booking.channel]}</Detail>
            <Detail label="Διαμέρισμα">
              {booking.assignment ? roomName(booking.assignment.roomId) : "Χρειάζεται διαμέρισμα"}
            </Detail>
            {details.data?.totalAmountCents != null ? (
              <Detail label="Ποσό">
                <MoneyText cents={details.data.totalAmountCents} />
              </Detail>
            ) : null}
            {details.data?.notes ? <Detail label="Σημειώσεις">{details.data.notes}</Detail> : null}
          </dl>

          {confirm && confirm.booking.id === booking.id ? (
            <div
              role="alertdialog"
              aria-labelledby="confirm-started"
              className="bg-warning-soft text-warning-text rounded-card p-4"
            >
              <p id="confirm-started" className="text-base mb-3 font-medium">
                {booking.guestName ?? "Ο επισκέπτης"} μένει ήδη στο {roomName(booking.assignment?.roomId)} από{" "}
                {formatDay(booking.checkin)}.{" "}
                {confirm.roomId === null
                  ? "Να βγει από το διαμέρισμα;"
                  : `Να μετακινηθεί στο ${roomName(confirm.roomId)} για τις υπόλοιπες νύχτες;`}
              </p>
              <div className="flex gap-3">
                <Button
                  variant="primary"
                  size="lg"
                  loading={moving}
                  onClick={() => onMove({ ...confirm, confirmStarted: true })}
                >
                  Ναι, μετακίνηση
                </Button>
                <Button size="lg" onClick={onCancelConfirm}>
                  Όχι
                </Button>
              </div>
            </div>
          ) : null}

          {booking.status === "pending" ? (
            <p className="bg-surface-muted rounded-card text-text-muted p-4">
              Η κράτηση δεν έχει επιβεβαιωθεί ακόμα, οπότε δεν μπαίνει σε διαμέρισμα.
            </p>
          ) : booking.checkout <= today ? (
            <p className="bg-surface-muted rounded-card text-text-muted p-4">
              Η διαμονή τελείωσε {formatDay(booking.checkout)}, οπότε δεν μετακινείται.
            </p>
          ) : (
            <section aria-labelledby="move-title" className="flex flex-col gap-3">
              <h3 id="move-title" className="text-base font-semibold">
                Μετακίνηση σε
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
                  Βγάλε την από το διαμέρισμα
                </Button>
              ) : null}
            </section>
          )}
        </div>
      ) : null}
    </SidePanel>
  );
}

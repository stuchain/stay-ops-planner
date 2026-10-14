"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { placeNights, type IsoDate, type StayPiece } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { readClientError, useErrorText } from "@/api/errors";
import type { CalendarBooking, CalendarRangeData, CalendarRoom, MoveResult } from "@/api/types";
import { formatDay, type UiLocale } from "@/ui/format";
import { showToast, undoToast } from "@/ui/Toast";

export type MoveRequest = {
  booking: CalendarBooking;
  roomId: string | null;
  confirmStarted?: boolean;
  /** Only the nights `[from, to)` move (a guest who changed apartment mid-stay); both left out moves the whole stay. */
  from?: IsoDate;
  to?: IsoDate;
};

/** Where the booking would be after the move, worked out in the browser for the optimistic update. */
export function piecesAfter(
  booking: CalendarBooking,
  roomId: string | null,
  from?: IsoDate,
  to?: IsoDate,
): StayPiece[] {
  if (roomId === null) return [];
  return placeNights(booking.pieces, from ?? booking.checkin, to ?? booking.checkout, roomId);
}

type Snapshot = { booking: CalendarBooking };

/**
 * Moves a booking with an optimistic update: every cached calendar range shows the booking
 * in its new place at once, that one booking is put back if the server says no, an undo toast
 * follows a success, and the ranges refresh in the background.
 */
export function useMoveBooking(rooms: CalendarRoom[], onNeedsConfirm: (request: MoveRequest) => void) {
  const t = useTranslations();
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const rangeKey = trpc.calendar.range.pathKey();

  function patchBooking(next: CalendarBooking) {
    queryClient.setQueriesData<CalendarRangeData>({ queryKey: rangeKey }, (data) => {
      if (!data || !data.bookings.some((b) => b.id === next.id)) return data;
      // A move answers without the Dev mode price, so the one already shown is kept.
      const bookings = data.bookings.map((b) => (b.id === next.id ? { ...b, ...next } : b));
      const unassigned = bookings.filter((b) => b.assignment === null && b.checkout > data.today).map((b) => b.id);
      return { ...data, bookings, unassigned };
    });
  }

  const roomName = (roomId: string | null) => rooms.find((r) => r.id === roomId)?.name ?? "";
  const locale = useLocale() as UiLocale;

  /** Puts the booking back the way it was, piece by piece (each step answers with the next version). */
  async function restore(after: CalendarBooking, before: readonly StayPiece[], confirmStarted: boolean) {
    const extra = confirmStarted ? { confirmStarted: true } : {};
    const first = before[0];
    let current = (
      await mutation.mutateAsync({
        bookingId: after.id,
        roomId: first?.roomId ?? null,
        expectedVersion: after.version,
        ...extra,
      })
    ).booking;
    for (const p of before.slice(1)) {
      current = (
        await mutation.mutateAsync({
          bookingId: after.id,
          roomId: p.roomId,
          expectedVersion: current.version,
          from: p.start,
          to: p.end,
          ...extra,
        })
      ).booking;
    }
  }

  const mutation = useMutation({
    ...trpc.booking.move.mutationOptions(),
    onMutate: async (input): Promise<Snapshot | undefined> => {
      await queryClient.cancelQueries({ queryKey: rangeKey });
      const cached = queryClient
        .getQueriesData<CalendarRangeData>({ queryKey: rangeKey })
        .flatMap(([, data]) => data?.bookings ?? [])
        .find((b) => b.id === input.bookingId);
      if (!cached) return undefined;
      const pieces = piecesAfter(
        cached,
        input.roomId,
        input.from as IsoDate | undefined,
        input.to as IsoDate | undefined,
      );
      patchBooking({
        ...cached,
        assignment: pieces[0] ? { roomId: pieces[0].roomId, pinned: true } : null,
        pieces,
      });
      return { booking: cached };
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot) patchBooking(snapshot.booking);
    },
    onSuccess: (result: MoveResult) => {
      patchBooking(result.booking);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: rangeKey });
      void queryClient.invalidateQueries({ queryKey: trpc.booking.suggestions.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.booking.details.pathKey() });
    },
  });

  async function move(request: MoveRequest, options: { undoable?: boolean } = {}): Promise<MoveResult | null> {
    const { booking, roomId } = request;
    const before = booking.pieces;
    const partial = request.from !== undefined || request.to !== undefined;
    try {
      const result = await mutation.mutateAsync({
        bookingId: booking.id,
        roomId,
        expectedVersion: booking.version,
        ...(request.confirmStarted ? { confirmStarted: true } : {}),
        ...(request.from !== undefined ? { from: request.from } : {}),
        ...(request.to !== undefined ? { to: request.to } : {}),
      });
      const room = rooms.find((r) => r.id === roomId);
      const message =
        roomId === null
          ? t("calendar.toast.removed", { room: roomName(before[0]?.roomId ?? null) })
          : partial
            ? t("calendar.toast.split", {
                room: roomName(roomId),
                date: formatDay(request.from ?? booking.checkin, locale),
              })
            : t("calendar.toast.moved", { room: roomName(roomId) });
      const warning =
        result.warnings.includes("OVER_CAPACITY") && room?.capacity != null
          ? t("booking.smallRoom", { count: room.capacity })
          : undefined;
      if (options.undoable === false) {
        showToast({ message, tone: "success" });
      } else {
        undoToast({
          message,
          undoLabel: t("common.undo"),
          ...(warning ? { warning } : {}),
          onUndo: () => {
            const confirmStarted = Boolean(request.confirmStarted);
            // One apartment before (also when this move split it): a single move back. A stay that was already
            // split is rebuilt piece by piece.
            const back =
              before.length <= 1
                ? move(
                    {
                      booking: result.booking,
                      roomId: before[0]?.roomId ?? null,
                      ...(confirmStarted ? { confirmStarted: true } : {}),
                    },
                    { undoable: false },
                  )
                : restore(result.booking, before, confirmStarted).then(
                    () => showToast({ message: t("calendar.toast.restored"), tone: "success" }),
                    (error: unknown) => showToast({ message: errorText(error), tone: "danger" }),
                  );
            void back;
          },
        });
      }
      return result;
    } catch (error) {
      if (readClientError(error).code === "STAY_STARTED") {
        onNeedsConfirm(request);
        return null;
      }
      showToast({ message: errorText(error), tone: "danger" });
      return null;
    }
  }

  return { move, pending: mutation.isPending };
}

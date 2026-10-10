"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { readClientError, useErrorText } from "@/api/errors";
import type { CalendarBooking, CalendarRangeData, CalendarRoom, MoveResult } from "@/api/types";
import { showToast, undoToast } from "@/ui/Toast";

export type MoveRequest = {
  booking: CalendarBooking;
  roomId: string | null;
  confirmStarted?: boolean;
};

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

  const mutation = useMutation({
    ...trpc.booking.move.mutationOptions(),
    onMutate: async (input): Promise<Snapshot | undefined> => {
      await queryClient.cancelQueries({ queryKey: rangeKey });
      const cached = queryClient
        .getQueriesData<CalendarRangeData>({ queryKey: rangeKey })
        .flatMap(([, data]) => data?.bookings ?? [])
        .find((b) => b.id === input.bookingId);
      if (!cached) return undefined;
      patchBooking({
        ...cached,
        assignment: input.roomId === null ? null : { roomId: input.roomId, pinned: true },
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
    const before = booking.assignment?.roomId ?? null;
    try {
      const result = await mutation.mutateAsync({
        bookingId: booking.id,
        roomId,
        expectedVersion: booking.version,
        ...(request.confirmStarted ? { confirmStarted: true } : {}),
      });
      const room = rooms.find((r) => r.id === roomId);
      const message =
        roomId === null
          ? t("calendar.toast.removed", { room: roomName(before) })
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
          onUndo: () =>
            void move(
              { booking: result.booking, roomId: before, ...(request.confirmStarted ? { confirmStarted: true } : {}) },
              { undoable: false },
            ),
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

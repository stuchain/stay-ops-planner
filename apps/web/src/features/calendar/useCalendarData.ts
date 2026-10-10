"use client";

import { useQueries, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import type { IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import type { CalendarBlock, CalendarBooking, CalendarRangeData, CalendarRoom } from "@/api/types";
import type { Span } from "./timeline";

export type CalendarData = {
  rooms: CalendarRoom[];
  bookings: Map<string, CalendarBooking>;
  blocks: CalendarBlock[];
  /** Bookings that need an apartment, by arrival; past stays are left out. */
  unassigned: CalendarBooking[];
  overbooked: Set<IsoDate>;
  today: IsoDate | null;
  loading: boolean;
  error: unknown;
  refetch: () => void;
};

function merge(
  results: Pick<UseQueryResult<CalendarRangeData, unknown>, "data" | "isPending" | "error">[],
): Omit<CalendarData, "refetch"> {
  const bookings = new Map<string, CalendarBooking>();
  const blocks = new Map<string, CalendarBlock>();
  const overbooked = new Set<IsoDate>();
  let rooms: CalendarRoom[] = [];
  let today: IsoDate | null = null;
  for (const r of results) {
    if (!r.data) continue;
    rooms = r.data.rooms;
    today = r.data.today;
    for (const b of r.data.bookings) bookings.set(b.id, b);
    for (const b of r.data.blocks) blocks.set(b.id, b);
    for (const n of r.data.overbookedNights) overbooked.add(n);
  }
  const unassigned = [...bookings.values()]
    .filter((b) => b.assignment === null && (today === null || b.checkout > today))
    .sort((a, b) => (a.checkin < b.checkin ? -1 : a.checkin > b.checkin ? 1 : 0));
  return {
    rooms,
    bookings,
    blocks: [...blocks.values()],
    unassigned,
    overbooked,
    today,
    loading: results.some((r) => r.isPending),
    error: results.find((r) => r.error)?.error ?? null,
  };
}

/** Loads the given blocks of the span (one `calendar.range` call each) and merges them. */
export function useCalendarData(span: Span, blockIndexes: number[]): CalendarData {
  const trpc = useTRPC();
  const merged = useQueries({
    queries: blockIndexes.map((i) => trpc.calendar.range.queryOptions(span.blocks[i]!)),
    combine: merge,
  });
  const queryClient = useQueryClient();
  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: trpc.calendar.range.pathKey() });
  }, [queryClient, trpc]);
  // While the blocks for a new scroll position load, keep the rows on screen so the
  // timeline keeps its width and scroll position.
  const lastRooms = useRef<CalendarRoom[]>([]);
  if (merged.rooms.length > 0) lastRooms.current = merged.rooms;
  return { ...merged, rooms: merged.rooms.length > 0 ? merged.rooms : lastRooms.current, refetch };
}

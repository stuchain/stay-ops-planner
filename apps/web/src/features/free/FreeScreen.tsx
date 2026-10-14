"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarDays, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { addDays, isIsoDate, type IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { AvailabilityData, AvailabilityRoom } from "@/api/types";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { DateText } from "@/ui/DateText";
import { ErrorState } from "@/ui/ErrorState";
import { nightsBetween } from "@/ui/format";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { busyText } from "../calendar/BookingPanel";
import { recommendationText } from "../calendar/recommendation";

const NEUTRAL = "#5B5852";
const MAX_NIGHTS = 60;
const MAX_GUESTS = 20;

const inputClass =
  "min-h-button rounded-sm border border-border bg-surface px-4 py-2 text-lg text-text w-full " +
  "placeholder:text-text-muted";

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-base font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

function RoomRow({ room, guests }: { room: AvailabilityRoom; guests: number | null }) {
  const t = useTranslations("free");
  const booking = useTranslations("booking");
  const small = room.available && room.warnings.includes("OVER_CAPACITY") && room.capacity !== null && guests !== null;
  const note = !room.available
    ? busyText(booking, room)
    : small
      ? t("small", { guests: guests ?? 0, capacity: room.capacity ?? 0 })
      : room.recommended
        ? recommendationText(booking, room.reasons, guests)
        : booking("free");
  return (
    <li
      className={cn(
        "rounded-sm flex flex-wrap items-center gap-x-4 gap-y-2 border",
        room.available ? "px-5 py-4" : "px-4 py-2",
        room.available && room.recommended ? "border-accent bg-accent-soft border-2" : "border-border bg-surface",
        !room.available && "bg-surface-muted text-text-muted",
      )}
    >
      <ApartmentChip
        name={room.name}
        color={room.color ?? NEUTRAL}
        inactive={!room.isActive}
        className={room.available ? "text-lg" : "text-base"}
      />
      <span
        className={cn(
          "min-w-0 flex-1",
          room.available ? "text-lg" : "text-base",
          small && "text-warning-text font-semibold",
          room.available && room.recommended && !small && "text-accent font-semibold",
        )}
      >
        {note}
      </span>
    </li>
  );
}

function Results({ data, guests }: { data: AvailabilityData; guests: number | null }) {
  const t = useTranslations("free");
  const free = data.rooms.filter((r) => r.available);
  const busy = data.rooms.filter((r) => !r.available);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-xl font-bold" role="status">
        {free.length === 0 ? t("noneFree") : t("freeCount", { free: free.length, total: data.rooms.length })}
      </p>
      {data.unassignedBookings > 0 ? (
        <div className="bg-warning-soft text-warning-text rounded-sm px-4 py-3 text-base">
          <p className="font-semibold">{t("unassigned", { count: data.unassignedBookings })}</p>
          <p>{t("unassignedHint")}</p>
        </div>
      ) : null}
      {free.length > 0 ? (
        <section aria-label={t("freeSection")} className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">{t("freeSection")}</h2>
          <ul className="flex flex-col gap-2">
            {free.map((room) => (
              <RoomRow key={room.roomId} room={room} guests={guests} />
            ))}
          </ul>
        </section>
      ) : null}
      {busy.length > 0 ? (
        <section aria-label={t("busySection")} className="flex flex-col gap-3">
          <h2 className="text-text-muted text-base font-semibold">{t("busySection")}</h2>
          <ul className="flex flex-col gap-2">
            {busy.map((room) => (
              <RoomRow key={room.roomId} room={room} guests={guests} />
            ))}
          </ul>
        </section>
      ) : null}
      <Link href="/app/calendar" className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg, "self-start")}>
        <CalendarDays size={24} aria-hidden="true" />
        {t("toCalendar")}
      </Link>
    </div>
  );
}

/** "Ποιο είναι ελεύθερο;": dates and people in, the free apartments out (recommended first). Read-only. */
export function FreeScreen() {
  const t = useTranslations("free");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const ids = useId();
  const summary = useQuery(trpc.today.summary.queryOptions());

  // Until the person picks an arrival, it is today (as the server sees it).
  const [pickedCheckin, setPickedCheckin] = useState<IsoDate | null>(null);
  // The stay length follows from the two dates; it is kept so a new arrival keeps the same number of nights.
  const [nights, setNights] = useState(2);
  const [guests, setGuests] = useState(2);

  const checkin = pickedCheckin ?? summary.data?.today ?? null;
  const checkout = checkin ? addDays(checkin, nights) : null;

  const onCheckin = (value: string) => {
    if (isIsoDate(value)) setPickedCheckin(value);
  };
  const onCheckout = (value: string) => {
    if (!checkin || !isIsoDate(value)) return;
    const n = nightsBetween(checkin, value);
    setNights(n >= 1 ? n : 0);
  };

  const tooLong = nights > MAX_NIGHTS;
  const invalid = nights < 1;
  const valid = checkin !== null && checkout !== null && !invalid && !tooLong;

  const availability = useQuery({
    ...trpc.availability.check.queryOptions({
      checkin: checkin ?? ("2000-01-01" as IsoDate),
      checkout: checkout ?? ("2000-01-02" as IsoDate),
      guests,
    }),
    enabled: valid,
    placeholderData: keepPreviousData,
  });

  const problem = invalid ? t("invalidDates") : tooLong ? t("tooLong") : null;

  return (
    <div className="flex flex-col gap-6 p-8 max-[759px]:p-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Card>
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] items-end gap-4 max-[1099px]:grid-cols-2 max-[519px]:grid-cols-1">
          <Field id={`${ids}-in`} label={t("arrival")}>
            <input
              id={`${ids}-in`}
              type="date"
              className={inputClass}
              value={checkin ?? ""}
              onChange={(e) => onCheckin(e.target.value)}
            />
          </Field>
          <Field id={`${ids}-out`} label={t("departure")}>
            <input
              id={`${ids}-out`}
              type="date"
              className={inputClass}
              value={checkout ?? ""}
              min={checkin ? addDays(checkin, 1) : undefined}
              disabled={checkin === null}
              onChange={(e) => onCheckout(e.target.value)}
            />
          </Field>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span id={`${ids}-guests`} className="text-base font-semibold">
              {t("guests")}
            </span>
            <div role="group" aria-labelledby={`${ids}-guests`} className="flex items-center gap-2">
              <button
                type="button"
                aria-label={t("fewerGuests")}
                disabled={guests <= 1}
                onClick={() => setGuests((g) => Math.max(1, g - 1))}
                className={cn(buttonBase, buttonVariants.secondary, "min-h-button min-w-button")}
              >
                <Minus size={24} aria-hidden="true" />
              </button>
              <span aria-live="polite" className="min-w-12 text-center text-2xl font-bold">
                {guests}
              </span>
              <button
                type="button"
                aria-label={t("moreGuests")}
                disabled={guests >= MAX_GUESTS}
                onClick={() => setGuests((g) => Math.min(MAX_GUESTS, g + 1))}
                className={cn(buttonBase, buttonVariants.secondary, "min-h-button min-w-button")}
              >
                <Plus size={24} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        {checkin && checkout && valid ? (
          <p className="text-text-muted text-base">
            <DateText date={checkin} to={checkout} withYear showNights />
          </p>
        ) : null}
        {problem ? (
          <p role="alert" className="text-danger-text text-base font-semibold">
            {problem}
          </p>
        ) : null}
      </Card>

      {!valid ? (
        problem ? null : (
          <Skeleton variant="block" className="h-64" />
        )
      ) : availability.data ? (
        <div className={cn(availability.isPlaceholderData && "opacity-60")}>
          <Results data={availability.data} guests={guests} />
        </div>
      ) : availability.error ? (
        <ErrorState message={errorText(availability.error)} onRetry={() => void availability.refetch()} />
      ) : (
        <div role="status" aria-label={t("loading")}>
          <Skeleton variant="block" className="h-64" />
        </div>
      )}
    </div>
  );
}

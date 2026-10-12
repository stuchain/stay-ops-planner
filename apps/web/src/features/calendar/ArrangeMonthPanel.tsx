"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CircleAlert, Wand2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import type { IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useOnline } from "@/api/online";
import { readClientError, useErrorText } from "@/api/errors";
import type { ArrangePlacement, ArrangeProposal, CalendarRoom } from "@/api/types";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Button } from "@/ui/Button";
import { DateText } from "@/ui/DateText";
import { ErrorState } from "@/ui/ErrorState";
import { SidePanel } from "@/ui/SidePanel";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";
import { recommendationText } from "./recommendation";

const NEUTRAL = "#5B5852";

export type ArrangeMonthPanelProps = {
  /** First day of the month to arrange, or null when the panel is closed. */
  month: IsoDate | null;
  rooms: CalendarRoom[];
  /** The preview's placements, to highlight on the grid while the panel is open. */
  onPreview: (placements: Map<string, string>) => void;
  onClose: () => void;
};

function PlacementRow({ placement, rooms }: { placement: ArrangePlacement; rooms: CalendarRoom[] }) {
  const t = useTranslations();
  const tBooking = useTranslations("booking");
  const room = rooms.find((r) => r.id === placement.roomId);
  const small = placement.warnings.includes("OVER_CAPACITY") && room?.capacity != null;
  const note = small
    ? tBooking("smallRoom", { count: room!.capacity! })
    : recommendationText(tBooking, placement.reasons, placement.partySize);
  return (
    <li className="border-border flex flex-col gap-2 rounded-sm border px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-base font-semibold">{placement.guestName ?? t("common.noName")}</span>
          <span className="text-text-muted text-sm">
            <DateText date={placement.checkin} to={placement.checkout} showNights />
            {placement.partySize !== null ? ` · ${t("common.people", { count: placement.partySize })}` : ""}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <ArrowRight size={20} aria-hidden="true" />
          <ApartmentChip name={room?.name ?? ""} color={room?.color ?? NEUTRAL} />
        </span>
      </div>
      <span className={small ? "text-warning-text text-sm font-semibold" : "text-text-muted text-sm"}>{note}</span>
    </li>
  );
}

function Proposal({ data, rooms }: { data: ArrangeProposal; rooms: CalendarRoom[] }) {
  const t = useTranslations("calendar.arrange");
  const noName = useTranslations("common")("noName");
  if (data.placements.length === 0 && data.unplaced.length === 0) {
    return <p className="bg-surface-muted rounded-card p-4 text-base">{t("nothing")}</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="text-base">{t("intro")}</p>
      {data.placements.length > 0 ? (
        <section aria-labelledby="arrange-placed" className="flex flex-col gap-3">
          <h3 id="arrange-placed" className="text-base font-semibold">
            {t("placedHeading", { count: data.placements.length })}
          </h3>
          <ul className="flex flex-col gap-2">
            {data.placements.map((p) => (
              <PlacementRow key={p.bookingId} placement={p} rooms={rooms} />
            ))}
          </ul>
        </section>
      ) : null}
      {data.unplaced.length > 0 ? (
        <section
          aria-labelledby="arrange-unplaced"
          className="bg-warning-soft text-warning-text rounded-card flex flex-col gap-2 p-4"
        >
          <h3 id="arrange-unplaced" className="flex items-center gap-2 text-base font-semibold">
            <CircleAlert size={20} aria-hidden="true" />
            {t("unplacedHeading", { count: data.unplaced.length })}
          </h3>
          <p className="text-sm">{t("unplacedNote")}</p>
          <ul className="flex flex-col gap-1">
            {data.unplaced.map((u) => (
              <li key={u.bookingId} className="text-sm flex flex-wrap gap-x-2">
                <span className="font-semibold">{u.guestName ?? noName}</span>
                <DateText date={u.checkin} to={u.checkout} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** "Τακτοποίησε τον μήνα": a preview of where the planner puts the month's unplaced bookings, applied in one go. */
export function ArrangeMonthPanel({ month, rooms, onPreview, onClose }: ArrangeMonthPanelProps) {
  const t = useTranslations("calendar.arrange");
  const online = useOnline();
  const locale = useLocale();
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const preview = useQuery({
    ...trpc.calendar.arrangePreview.queryOptions({ month: (month ?? "").slice(0, 7) }),
    enabled: month !== null,
    // Always plan from the latest data when the panel opens.
    staleTime: 0,
    gcTime: 0,
  });
  const apply = useMutation(trpc.calendar.arrangeApply.mutationOptions({ meta: { handlesErrors: true } }));

  const data = month !== null ? preview.data : undefined;
  useEffect(() => {
    onPreview(new Map((data?.placements ?? []).map((p) => [p.bookingId, p.roomId])));
  }, [data, onPreview]);

  async function onApply() {
    if (!data) return;
    try {
      const result = await apply.mutateAsync({
        placements: data.placements.map((p) => ({
          bookingId: p.bookingId,
          roomId: p.roomId,
          expectedVersion: p.version,
        })),
      });
      showToast({ tone: "success", message: t("applied", { count: result.placed }) });
      onClose();
    } catch (error) {
      showToast({ tone: "danger", message: errorText(error) });
      // Something changed since the preview: plan again from what is there now.
      if (readClientError(error).code === "CHANGED_MEANWHILE") void preview.refetch();
    } finally {
      void queryClient.invalidateQueries({ queryKey: trpc.calendar.range.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.booking.suggestions.pathKey() });
    }
  }

  const monthName =
    month === null
      ? ""
      : new Intl.DateTimeFormat(locale === "el" ? "el-GR" : "en-GB", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${month}T00:00:00Z`));

  return (
    <SidePanel
      open={month !== null}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={
        <span className="flex items-center gap-2">
          <Wand2 size={22} aria-hidden="true" />
          {t("title", { month: monthName })}
        </span>
      }
      footer={
        data && data.placements.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              size="lg"
              loading={apply.isPending}
              disabled={!online}
              onClick={() => void onApply()}
            >
              {t("apply", { count: data.placements.length })}
            </Button>
            <Button size="lg" onClick={onClose} disabled={apply.isPending}>
              {t("cancel")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {data ? (
        <Proposal data={data} rooms={rooms} />
      ) : preview.error ? (
        <ErrorState message={errorText(preview.error)} onRetry={() => void preview.refetch()} />
      ) : (
        <div role="status" aria-label={t("loading")} className="flex flex-col gap-3">
          <Skeleton variant="block" className="h-20" />
          <Skeleton variant="block" className="h-20" />
          <Skeleton variant="block" className="h-20" />
        </div>
      )}
    </SidePanel>
  );
}

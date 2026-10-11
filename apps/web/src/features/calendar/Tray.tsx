"use client";

import { useDroppable } from "@dnd-kit/core";
import { Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CalendarBooking } from "@/api/types";
import { cn } from "@/ui/cn";
import { DraggableBar } from "./DraggableBar";

export type TrayProps = {
  bookings: CalendarBooking[];
  selectedId: string | null;
  /** A placed booking is being dragged: dropping here takes it out of its apartment. */
  acceptsDrop: boolean;
  onOpen: (bookingId: string) => void;
};

/** "Χρειάζονται διαμέρισμα": new bookings waiting for an apartment, above the rows. */
export function Tray({ bookings, selectedId, acceptsDrop, onOpen }: TrayProps) {
  const t = useTranslations("calendar.tray");
  const { setNodeRef, isOver } = useDroppable({ id: "tray", disabled: !acceptsDrop });
  return (
    <section
      ref={setNodeRef}
      aria-labelledby="tray-title"
      className={cn(
        "bg-surface border-border shadow-card rounded-card border p-4",
        acceptsDrop && "border-warning border-2 border-dashed",
        isOver && "bg-warning-soft",
      )}
    >
      <h2 id="tray-title" className="text-base mb-3 flex items-center gap-2 font-semibold">
        <Inbox size={24} strokeWidth={2} aria-hidden="true" />
        {t("title")}
        <span className="bg-warning-soft text-warning-text text-sm rounded-pill px-2.5 py-0.5">{bookings.length}</span>
      </h2>
      {bookings.length === 0 ? (
        <p className="text-text-muted text-sm">{acceptsDrop ? t("dropHere") : t("allPlaced")}</p>
      ) : (
        <ul className="flex gap-3 overflow-x-auto pb-1">
          {bookings.map((b) => (
            <li key={b.id} className="w-64 flex-none">
              <DraggableBar booking={b} selected={b.id === selectedId} needsRoom onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

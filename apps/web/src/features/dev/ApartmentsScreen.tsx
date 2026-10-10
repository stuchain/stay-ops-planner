"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, Pencil, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { ApartmentRow } from "@/api/types";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { IconButton } from "@/ui/IconButton";
import { PageHeader } from "@/ui/PageHeader";
import { SidePanel } from "@/ui/SidePanel";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";

const NEUTRAL = "#5B5852";

type Draft = {
  name: string;
  color: string;
  capacity: string;
  preferredForLargeParty: boolean;
  isActive: boolean;
};

function draftOf(row: ApartmentRow): Draft {
  return {
    name: row.name,
    color: row.color ?? NEUTRAL,
    capacity: row.capacity === null ? "" : String(row.capacity),
    preferredForLargeParty: row.preferredForLargeParty,
    isActive: row.isActive,
  };
}

const field = "border-border bg-surface min-h-target rounded-sm border px-3 text-base";

function EditPanel({ row, onClose }: { row: ApartmentRow | null; onClose: () => void }) {
  const t = useTranslations("dev.apartments");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(row ? draftOf(row) : null);
  useEffect(() => setDraft(row ? draftOf(row) : null), [row]);

  const save = useMutation({
    ...trpc.dev.apartments.update.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: trpc.dev.apartments.list.queryKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.calendar.range.pathKey() });
      showToast({ message: t("saved"), tone: "success" });
      onClose();
    },
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!row || !draft) return;
    const capacity = draft.capacity.trim() === "" ? null : Number(draft.capacity);
    save.mutate({
      id: row.id,
      patch: {
        name: draft.name.trim(),
        color: draft.color,
        capacity,
        preferredForLargeParty: draft.preferredForLargeParty,
        isActive: draft.isActive,
      },
    });
  }

  return (
    <SidePanel
      open={row !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={row ? row.name : ""}
      {...(row?.rental ? { description: t("rentalLine", { id: row.rental.id }) } : {})}
    >
      {draft ? (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{t("name")}</span>
            <input
              className={field}
              value={draft.name}
              required
              maxLength={60}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{t("color")}</span>
            <input
              type="color"
              className="border-border h-12 w-24 rounded-sm border"
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{t("capacity")}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              className={cn(field, "w-28")}
              value={draft.capacity}
              onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="size-6"
              checked={draft.preferredForLargeParty}
              onChange={(e) => setDraft({ ...draft, preferredForLargeParty: e.target.checked })}
            />
            <span>{t("preferredLarge")}</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="size-6"
              checked={draft.isActive}
              onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
            />
            <span>{t("active")}</span>
          </label>
          <div className="flex gap-3">
            <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
              {t("save")}
            </Button>
            <Button size="lg" onClick={onClose}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </SidePanel>
  );
}

function Row({
  row,
  index,
  count,
  onEdit,
  onShift,
}: {
  row: ApartmentRow;
  index: number;
  count: number;
  onEdit: () => void;
  onShift: (delta: -1 | 1) => void;
}) {
  const t = useTranslations("dev.apartments");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "border-border border-b",
        isDragging && "bg-accent-soft relative z-10",
        !row.isActive && "text-text-muted",
      )}
    >
      <td className="py-2 pl-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="text-text-muted hover:bg-surface-muted flex size-11 cursor-grab items-center justify-center rounded-sm"
            aria-label={t("drag", { name: row.name })}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={20} aria-hidden="true" />
          </button>
          <IconButton
            label={t("moveUp", { name: row.name })}
            icon={ArrowUp}
            disabled={index === 0}
            onClick={() => onShift(-1)}
          />
          <IconButton
            label={t("moveDown", { name: row.name })}
            icon={ArrowDown}
            disabled={index === count - 1}
            onClick={() => onShift(1)}
          />
        </div>
      </td>
      <td className="px-3 py-2">
        <ApartmentChip name={row.name} color={row.color ?? NEUTRAL} inactive={!row.isActive} />
      </td>
      <td className="px-3 py-2 tabular-nums">{row.capacity ?? t("notSet")}</td>
      <td className="px-3 py-2">{row.preferredForLargeParty ? t("yes") : t("no")}</td>
      <td className="px-3 py-2">{row.isActive ? t("inUse") : t("notInUse")}</td>
      <td className="px-3 py-2">
        {row.rental ? (
          <span className="flex flex-col">
            <span className="font-mono text-sm">{row.rental.id}</span>
            {row.rental.title ? <span className="text-text-muted text-sm">{row.rental.title}</span> : null}
          </span>
        ) : (
          t("noRental")
        )}
      </td>
      <td className="px-3 py-2 tabular-nums">{row.upcomingBookings}</td>
      <td className="py-2 pr-2 text-right">
        {row.needsSetup ? (
          <Button variant="primary" icon={Settings2} onClick={onEdit}>
            {t("setUp")}
          </Button>
        ) : (
          <Button icon={Pencil} onClick={onEdit}>
            {t("edit")}
          </Button>
        )}
      </td>
    </tr>
  );
}

/** Dev mode: the apartments, their capacity, colour and order, and the Hosthub rental each one is linked to. */
export function ApartmentsScreen() {
  const t = useTranslations("dev.apartments");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const listKey = trpc.dev.apartments.list.queryKey();
  const list = useQuery(trpc.dev.apartments.list.queryOptions());
  const [editingId, setEditingId] = useState<string | null>(null);

  const reorder = useMutation(
    trpc.dev.apartments.reorder.mutationOptions({
      onMutate: async ({ ids }): Promise<{ before: ApartmentRow[] | undefined }> => {
        await queryClient.cancelQueries({ queryKey: listKey });
        const before = queryClient.getQueryData<ApartmentRow[]>(listKey);
        if (before) {
          const byId = new Map(before.map((r) => [r.id, r]));
          queryClient.setQueryData(
            listKey,
            ids.flatMap((id) => byId.get(id) ?? []),
          );
        }
        return { before };
      },
      onError: (error, _input, context) => {
        if (context?.before) queryClient.setQueryData(listKey, context.before);
        showToast({ message: errorText(error), tone: "danger" });
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: listKey });
        void queryClient.invalidateQueries({ queryKey: trpc.calendar.range.pathKey() });
      },
    }),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const rows = list.data ?? [];
  const editing = rows.find((r) => r.id === editingId) ?? null;
  const setUpCount = rows.filter((r) => r.needsSetup).length;

  function moveTo(from: number, to: number) {
    if (from === to || to < 0 || to >= rows.length) return;
    reorder.mutate({ ids: arrayMove(rows, from, to).map((r) => r.id) });
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    moveTo(
      rows.findIndex((r) => r.id === event.active.id),
      rows.findIndex((r) => r.id === event.over?.id),
    );
  }

  return (
    <div className="flex flex-col gap-6 p-8 max-[759px]:p-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {setUpCount > 0 ? (
        <p role="status" className="bg-warning-soft text-warning-text rounded-card p-4 font-medium">
          {t("needsSetup", { count: setUpCount })}
        </p>
      ) : null}
      {list.isPending ? (
        <Skeleton variant="block" className="h-64" />
      ) : list.error ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <div className="bg-surface shadow-card rounded-card relative overflow-x-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <table className="w-full min-w-[860px] text-left">
              <thead className="text-text-muted text-sm">
                <tr className="border-border border-b">
                  <th className="py-3 pl-4 font-semibold">{t("order")}</th>
                  <th className="px-3 py-3 font-semibold">{t("name")}</th>
                  <th className="px-3 py-3 font-semibold">{t("capacity")}</th>
                  <th className="px-3 py-3 font-semibold">{t("preferredLargeShort")}</th>
                  <th className="px-3 py-3 font-semibold">{t("status")}</th>
                  <th className="px-3 py-3 font-semibold">{t("rental")}</th>
                  <th className="px-3 py-3 font-semibold">{t("upcoming")}</th>
                  <th className="py-3 pr-4">
                    <span className="sr-only">{t("actions")}</span>
                  </th>
                </tr>
              </thead>
              <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {rows.map((row, index) => (
                    <Row
                      key={row.id}
                      row={row}
                      index={index}
                      count={rows.length}
                      onEdit={() => setEditingId(row.id)}
                      onShift={(delta) => moveTo(index, index + delta)}
                    />
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </DndContext>
        </div>
      )}
      <EditPanel row={editing} onClose={() => setEditingId(null)} />
    </div>
  );
}

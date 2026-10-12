"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { useTRPC } from "@/api/client";
import { useOnline } from "@/api/online";
import { useErrorText } from "@/api/errors";
import type { BookingDetails, CalendarBooking } from "@/api/types";
import { Button } from "@/ui/Button";
import { useCanChange } from "@/features/shell/role";
import { showToast, undoToast } from "@/ui/Toast";

type Field = "guestName" | "partySize" | "notes";

const FIELDS: readonly Field[] = ["guestName", "partySize", "notes"];

type Draft = { guestName: string; partySize: string; notes: string };

type Changes = { guestName?: string; partySize?: number; notes?: string };

/**
 * How to put fields back to what they were before a save: values the server accepts are sent again (sending
 * Hosthub's own value clears the change), an empty name or number of people is restored from Hosthub.
 */
export function undoPlan(before: Draft, fields: readonly Field[]): { restore: Changes; reset: Field[] } {
  const restore: Changes = {};
  const reset: Field[] = [];
  for (const field of fields) {
    const value = before[field].trim();
    if (field === "notes") restore.notes = value;
    else if (field === "guestName") {
      if (value === "") reset.push(field);
      else restore.guestName = value;
    } else {
      const n = Number(value);
      if (value === "" || !Number.isInteger(n) || n < 1 || n > 99) reset.push(field);
      else restore.partySize = n;
    }
  }
  return { restore, reset };
}

const inputClass =
  "min-h-button rounded-sm border border-border bg-surface px-4 py-2 text-base text-text w-full " +
  "placeholder:text-text-muted";

function startDraft(booking: CalendarBooking, details: BookingDetails): Draft {
  return {
    guestName: booking.guestName ?? "",
    partySize: booking.partySize === null ? "" : String(booking.partySize),
    notes: details.notes ?? "",
  };
}

/** The person's changes, as the server wants them. Null when a value is not acceptable. */
function changesOf(
  start: Draft,
  draft: Draft,
): { changes: { guestName?: string; partySize?: number; notes?: string }; errors: Partial<Record<Field, string>> } {
  const changes: { guestName?: string; partySize?: number; notes?: string } = {};
  const errors: Partial<Record<Field, string>> = {};
  if (draft.guestName.trim() !== start.guestName.trim()) {
    if (draft.guestName.trim() === "") errors.guestName = "nameRequired";
    else changes.guestName = draft.guestName.trim();
  }
  if (draft.partySize.trim() !== start.partySize.trim()) {
    const n = Number(draft.partySize);
    if (!Number.isInteger(n) || n < 1 || n > 99 || draft.partySize.trim() === "") errors.partySize = "peopleInvalid";
    else changes.partySize = n;
  }
  if (draft.notes.trim() !== start.notes.trim()) changes.notes = draft.notes.trim();
  return { changes, errors };
}

export type BookingEditProps = {
  booking: CalendarBooking;
  details: BookingDetails;
  /** Tells the screen whether there are unsaved changes. */
  onDirtyChange: (dirty: boolean) => void;
};

/** Guest name, number of people and notes: shown in words, changed with the "Αλλαγή" button. */
export function BookingEdit({ booking, details, onDirtyChange }: BookingEditProps) {
  const t = useTranslations("bookingEdit");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const online = useOnline();
  const canChange = useCanChange();
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => startDraft(booking, details));
  const [showErrors, setShowErrors] = useState(false);
  const idBase = useId();

  const start = startDraft(booking, details);
  const { changes, errors } = changesOf(start, draft);
  const dirty = editing && (Object.keys(changes).length > 0 || Object.keys(errors).length > 0);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: trpc.calendar.range.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.booking.details.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.booking.history.pathKey() });
  }

  const update = useMutation({
    ...trpc.booking.updateDetails.mutationOptions(),
    onSuccess: () => {
      setEditing(false);
      setShowErrors(false);
    },
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
    onSettled: refresh,
  });
  const reset = useMutation({
    ...trpc.booking.resetField.mutationOptions(),
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
    onSettled: refresh,
  });
  // Undo sends its own requests so the save and reset toasts above are not shown again.
  const undoUpdate = useMutation(trpc.booking.updateDetails.mutationOptions({ meta: { handlesErrors: true } }));
  const undoReset = useMutation(trpc.booking.resetField.mutationOptions({ meta: { handlesErrors: true } }));

  /** Puts the fields back as they were before the change that left the booking at `version`. */
  async function undo(before: Draft, fields: readonly Field[], version: number) {
    const plan = undoPlan(before, fields);
    try {
      let current = version;
      if (Object.keys(plan.restore).length > 0) {
        current = (await undoUpdate.mutateAsync({ bookingId: booking.id, expectedVersion: current, ...plan.restore }))
          .version;
      }
      for (const field of plan.reset) {
        current = (await undoReset.mutateAsync({ bookingId: booking.id, field, expectedVersion: current })).version;
      }
      showToast({ message: t("undone"), tone: "success" });
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
    } finally {
      refresh();
    }
  }

  function offerUndo(message: string, before: Draft, fields: readonly Field[], version: number) {
    undoToast({ message, undoLabel: tCommon("undo"), onUndo: () => void undo(before, fields, version) });
  }

  function open() {
    setDraft(startDraft(booking, details));
    setShowErrors(false);
    setEditing(true);
  }

  function save() {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return;
    }
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    const before = start;
    const fields = Object.keys(changes) as Field[];
    update.mutate(
      { bookingId: booking.id, expectedVersion: booking.version, ...changes },
      { onSuccess: (result) => offerUndo(t("saved"), before, fields, result.version) },
    );
  }

  function fromHosthub(field: Field) {
    const local = details.local[field];
    if (!local) return null;
    const value = local.hosthub;
    return value === null || value === "" ? t("fromHosthubEmpty") : t("fromHosthub", { value: String(value) });
  }

  const labels: Record<Field, string> = {
    guestName: t("guestName"),
    partySize: t("partySize"),
    notes: t("notes"),
  };

  const valueOf: Record<Field, string> = {
    guestName: booking.guestName ?? "",
    partySize: booking.partySize === null ? "" : String(booking.partySize),
    notes: details.notes ?? "",
  };

  function row(field: Field) {
    const hosthub = fromHosthub(field);
    return (
      <div key={field} className="py-2">
        <dt className="text-text-muted">{labels[field]}</dt>
        <dd className="font-medium break-words whitespace-pre-wrap">
          {valueOf[field] === "" ? (field === "notes" ? t("noNotes") : "–") : valueOf[field]}
        </dd>
        {hosthub && canChange ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3">
            <span className="text-text-muted">{hosthub}</span>
            <Button
              variant="ghost"
              loading={reset.isPending && reset.variables?.field === field}
              disabled={reset.isPending}
              aria-label={t("resetAria", { field: labels[field] })}
              onClick={() => {
                const before = start;
                reset.mutate(
                  { bookingId: booking.id, field, expectedVersion: booking.version },
                  { onSuccess: (result) => offerUndo(t("restored"), before, [field], result.version) },
                );
              }}
            >
              {t("reset")}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const fieldErrors: Record<Field, string | null> = {
    guestName: errorFor("guestName"),
    partySize: errorFor("partySize"),
    notes: null,
  };
  const hosthubTexts: Record<Field, string | null> = {
    guestName: fromHosthub("guestName"),
    partySize: fromHosthub("partySize"),
    notes: fromHosthub("notes"),
  };
  function errorFor(field: Field) {
    return showErrors && errors[field] ? t(errors[field] as "nameRequired") : null;
  }
  return (
    <section aria-labelledby={`${idBase}-title`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 id={`${idBase}-title`} className="text-base font-semibold">
          {t("title")}
        </h3>
        {editing || !canChange ? null : (
          <Button onClick={open} size="md" disabled={!online}>
            {t("change")}
          </Button>
        )}
      </div>

      {editing ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idBase}-name`} className="font-medium">
              {labels.guestName}
            </label>
            <input
              id={`${idBase}-name`}
              className={inputClass}
              value={draft.guestName}
              maxLength={160}
              aria-invalid={fieldErrors.guestName ? true : undefined}
              onChange={(e) => setDraft({ ...draft, guestName: e.target.value })}
            />
            {fieldErrors.guestName ? <p className="text-danger-text">{fieldErrors.guestName}</p> : null}
            {hosthubTexts.guestName ? <p className="text-text-muted">{hosthubTexts.guestName}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idBase}-people`} className="font-medium">
              {labels.partySize}
            </label>
            <input
              id={`${idBase}-people`}
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={draft.partySize}
              aria-invalid={fieldErrors.partySize ? true : undefined}
              onChange={(e) => setDraft({ ...draft, partySize: e.target.value })}
            />
            {fieldErrors.partySize ? <p className="text-danger-text">{fieldErrors.partySize}</p> : null}
            {hosthubTexts.partySize ? <p className="text-text-muted">{hosthubTexts.partySize}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idBase}-notes`} className="font-medium">
              {labels.notes}
            </label>
            <textarea
              id={`${idBase}-notes`}
              className={`${inputClass} min-h-32`}
              rows={4}
              maxLength={5000}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
            {hosthubTexts.notes ? <p className="text-text-muted">{hosthubTexts.notes}</p> : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" size="lg" loading={update.isPending} disabled={!online}>
              {t("save")}
            </Button>
            <Button type="button" size="lg" disabled={update.isPending} onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="divide-border divide-y">{FIELDS.map(row)}</dl>
      )}
    </section>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { useOnline } from "@/api/online";
import type { PreviousStays } from "@/api/types";
import { Button } from "@/ui/Button";
import { formatMonthYear, type UiLocale } from "@/ui/format";
import { showToast } from "@/ui/Toast";
import { ReturningLines } from "./ReturningGuest";

const MAX_LENGTH = 2000;

const inputClass =
  "min-h-24 rounded-sm border border-border bg-surface px-4 py-2 text-base text-text w-full " +
  "placeholder:text-text-muted";

type Stay = PreviousStays["sure"][number];

/** Notes written on the guest's earlier stays, newest first. Nothing when there are none. */
function EarlierNotes({ stays, title }: { stays: Stay[]; title: string }) {
  const t = useTranslations("guestNotes");
  const guest = useTranslations("guest");
  const locale = useLocale() as UiLocale;
  const withNotes = stays.filter((s) => s.note);
  if (withNotes.length === 0) return null;
  return (
    <div className="bg-warning-soft rounded-card flex flex-col gap-2 p-4" data-testid="earlier-guest-notes">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="flex flex-col gap-2">
        {withNotes.map((s) => (
          <li key={s.bookingId}>
            <p className="break-words whitespace-pre-wrap">{s.note}</p>
            <p className="text-text-muted text-sm">
              {t("from", {
                apartment: s.apartment ?? guest("noApartment"),
                month: formatMonthYear(s.checkin, locale),
              })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The booking panel's guest section: earlier stays of the same guest, the notes the team wrote on them, and this
 * booking's own note about the guest, which comes back when the guest books again.
 */
export function GuestNotes({ bookingId, note }: { bookingId: string; note: string | null }) {
  const t = useTranslations("guestNotes");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const online = useOnline();
  const id = useId();
  const previous = useQuery(trpc.booking.previousStays.queryOptions({ bookingId }));
  const [draft, setDraft] = useState(note ?? "");
  const save = useMutation({
    ...trpc.booking.setGuestNote.mutationOptions(),
    onSuccess: (saved) => {
      setDraft(saved.guestNote ?? "");
      showToast({ message: t("saved"), tone: "success" });
    },
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: trpc.booking.details.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.booking.history.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.today.summary.pathKey() });
    },
  });
  const changed = draft.trim() !== (note ?? "").trim();

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      {previous.data ? <ReturningLines previous={previous.data} /> : null}
      {previous.data ? <EarlierNotes stays={previous.data.sure} title={t("earlier")} /> : null}
      {previous.data ? <EarlierNotes stays={previous.data.maybe} title={t("earlierMaybe")} /> : null}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) save.mutate({ bookingId, note: draft });
        }}
      >
        <label id={`${id}-title`} htmlFor={`${id}-note`} className="text-base font-semibold">
          {t("title")}
        </label>
        <p id={`${id}-help`} className="text-text-muted text-sm">
          {t("help")}
        </p>
        <textarea
          id={`${id}-note`}
          aria-describedby={`${id}-help`}
          className={inputClass}
          rows={3}
          maxLength={MAX_LENGTH}
          placeholder={t("placeholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {changed ? (
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={save.isPending}
            disabled={!online}
            className="self-start"
          >
            {t("save")}
          </Button>
        ) : null}
      </form>
    </section>
  );
}

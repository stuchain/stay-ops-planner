"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState, type ChangeEvent } from "react";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { RouterOutputs } from "@/api/types";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Button } from "@/ui/Button";
import { formatRange, type UiLocale } from "@/ui/format";
import { showToast } from "@/ui/Toast";
import { FoldCard } from "./FoldCard";

type Preview = RouterOutputs["admin"]["paperCalendar"]["preview"];
type Item = Preview["items"][number];
type Applied = RouterOutputs["admin"]["paperCalendar"]["save"];

/** Things to save: a stay with no apartment yet, or one the Excel puts somewhere else. */
const toSave = (item: Item) => item.state === "new" || item.state === "change";

/** Ticked at first: everything to save, except a match on the dates alone (the name in the Excel differs). */
const tickedAtFirst = (item: Item) => toSave(item) && item.kind !== "name";

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function Pieces({ pieces }: { pieces: Item["proposed"] }) {
  const locale = useLocale() as UiLocale;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {pieces.map((p, i) => (
        <span key={p.start} className="inline-flex items-center gap-1">
          {i > 0 ? <span aria-hidden="true">→</span> : null}
          <ApartmentChip name={p.roomName} />
          {pieces.length > 1 ? <span className="text-xs">{formatRange(p.start, p.end, locale)}</span> : null}
        </span>
      ))}
    </span>
  );
}

function ItemRow({ item, ticked, onTick }: { item: Item; ticked: boolean; onTick: (on: boolean) => void }) {
  const t = useTranslations("paperCalendar");
  const locale = useLocale() as UiLocale;
  const booking = item.booking!;
  const id = useId();
  return (
    <li className="flex gap-3 py-3" data-testid="paper-item">
      <input
        id={id}
        type="checkbox"
        checked={ticked}
        onChange={(e) => onTick(e.target.checked)}
        className="mt-1 size-6 flex-none"
      />
      <label htmlFor={id} className="flex min-w-0 flex-col gap-1">
        <span>
          <span className="font-semibold">{booking.guestName ?? t("noName")}</span>
          <span className="text-text-muted text-sm"> · {formatRange(booking.checkin, booking.checkout, locale)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("now")}</span>
          {item.current.length > 0 ? (
            <Pieces pieces={item.current} />
          ) : (
            <span className="font-semibold">{t("noApartment")}</span>
          )}
          <span aria-hidden="true">⟶</span>
          <span>{t("excel")}</span>
          <Pieces pieces={item.proposed} />
        </span>
        {item.kind === "name" ? (
          <span className="text-warning text-sm">{t("otherName", { name: item.paperName })}</span>
        ) : item.kind === "dates" ? (
          <span className="text-warning text-sm">
            {t("otherDates", { name: item.paperName, dates: formatRange(item.paperStart, item.paperEnd, locale) })}
          </span>
        ) : null}
      </label>
    </li>
  );
}

function SkippedList({ applied }: { applied: Applied }) {
  const t = useTranslations("paperCalendar");
  if (applied.skipped.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" role="status">
      <p className="font-semibold">{t("skippedTitle", { count: applied.skipped.length })}</p>
      <ul className="list-disc pl-6 text-sm">
        {applied.skipped.map((s) => (
          <li key={s.bookingId}>
            {s.guestName ?? t("noName")}: {t(`skip.${s.reason}`, { guest: s.otherGuest ?? "" })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Admins only: upload the family's Excel calendar (Φύλλο1) to fill in which apartment past guests stayed in.
 * Nothing changes until the person reviews the list and presses Save.
 */
export function PaperCalendarCard() {
  const t = useTranslations("paperCalendar");
  const locale = useLocale() as UiLocale;
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [file, setFile] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<Applied | null>(null);

  const preview = useMutation(
    trpc.admin.paperCalendar.preview.mutationOptions({
      onSuccess: (data) => setTicked(new Set(data.items.filter(tickedAtFirst).map((i) => i.booking!.id))),
      onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
    }),
  );
  const apply = useMutation(
    trpc.admin.paperCalendar.save.mutationOptions({
      onSuccess: (result) => {
        setApplied(result);
        showToast({ message: t("saved", { count: result.saved }), tone: "success" });
        void queryClient.invalidateQueries();
        if (file) preview.mutate({ fileBase64: file });
      },
      onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
    }),
  );

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    const base64 = await fileToBase64(chosen);
    setFile(base64);
    setApplied(null);
    preview.mutate({ fileBase64: base64 });
  }

  const data = preview.data;
  const lists = useMemo(() => {
    const items = data?.items ?? [];
    return {
      save: items.filter(toSave),
      same: items.filter((i) => i.state === "same").length,
      missing: items.filter((i) => i.state === "missing"),
      newCount: items.filter((i) => i.state === "new").length,
      changeCount: items.filter((i) => i.state === "change").length,
    };
  }, [data]);
  const chosen = lists.save.filter((i) => ticked.has(i.booking!.id));

  function save() {
    apply.mutate({
      items: chosen.map((i) => ({
        bookingId: i.booking!.id,
        expectedVersion: i.booking!.version,
        pieces: i.proposed.map((p) => ({ roomId: p.roomId, start: p.start, end: p.end })),
      })),
    });
  }

  return (
    <FoldCard summary={t("title")} testId="paper-calendar-card">
      <p className="text-base">{t("intro")}</p>
      <div>
        <input
          id={inputId}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => void pick(e)}
          data-testid="paper-calendar-file"
        />
        <Button
          variant="secondary"
          loading={preview.isPending}
          onClick={() => document.getElementById(inputId)?.click()}
        >
          <FileSpreadsheet size={20} aria-hidden="true" />
          {data ? t("pickAgain") : t("pick")}
        </Button>
      </div>

      {applied ? <SkippedList applied={applied} /> : null}

      {data ? (
        <div className="flex flex-col gap-3">
          <p className="font-semibold" role="status">
            {lists.save.length === 0
              ? t("nothingToDo", { same: lists.same })
              : t("summary", { newCount: lists.newCount, changeCount: lists.changeCount, same: lists.same })}
          </p>
          {lists.save.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setTicked(new Set(lists.save.map((i) => i.booking!.id)))}>
                  {t("tickAll")}
                </Button>
                <Button variant="ghost" onClick={() => setTicked(new Set())}>
                  {t("tickNone")}
                </Button>
              </div>
              <ul className="divide-border divide-y" aria-label={t("listLabel")}>
                {lists.save.map((item) => (
                  <ItemRow
                    key={item.booking!.id}
                    item={item}
                    ticked={ticked.has(item.booking!.id)}
                    onTick={(on) =>
                      setTicked((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(item.booking!.id);
                        else next.delete(item.booking!.id);
                        return next;
                      })
                    }
                  />
                ))}
              </ul>
              <div>
                <Button variant="primary" loading={apply.isPending} disabled={chosen.length === 0} onClick={save}>
                  {t("save", { count: chosen.length })}
                </Button>
              </div>
            </>
          ) : null}

          {lists.missing.length > 0 ? (
            <details>
              <summary className="min-h-target cursor-pointer font-semibold">
                {t("missingTitle", { count: lists.missing.length })}
              </summary>
              <p className="text-text-muted text-sm">{t("missingHint")}</p>
              <ul className="list-disc pl-6 text-sm">
                {lists.missing.map((i) => (
                  <li key={`${i.paperName}-${i.paperStart}`}>
                    {i.paperName} · {formatRange(i.paperStart, i.paperEnd, locale)} ·{" "}
                    {i.paperPieces.map((p) => p.roomName).join(" → ")}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {data.notInCalendar.length > 0 ? (
            <details>
              <summary className="min-h-target cursor-pointer font-semibold">
                {t("notInCalendarTitle", { count: data.notInCalendar.length })}
              </summary>
              <ul className="list-disc pl-6 text-sm">
                {data.notInCalendar.map((b) => (
                  <li key={b.id}>
                    {b.guestName ?? t("noName")} · {formatRange(b.checkin, b.checkout, locale)} ·{" "}
                    {b.current.length > 0 ? b.current.map((p) => p.roomName).join(" → ") : t("noApartment")}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </FoldCard>
  );
}

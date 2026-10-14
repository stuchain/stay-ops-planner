"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Star, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { ReviewSourceData } from "@/api/types";
import { compactFieldClass } from "@/ui/field";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ErrorState } from "@/ui/ErrorState";
import { formatDay, type UiLocale } from "@/ui/format";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";
import { Delta } from "./Delta";

type Platform = ReviewSourceData["platform"];
const PLATFORMS: Platform[] = ["airbnb", "booking", "google"];

const input = `${compactFieldClass} w-full min-w-0`;

/** "4,92" or "4.92" as a number; null when empty; NaN when not a number. */
export function parseScore(text: string): number | null {
  const v = text.trim().replace(",", ".");
  if (v === "") return null;
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : Number.NaN;
}

function ScoreForm({ source, onSaved }: { source: ReviewSourceData; onSaved: () => void }) {
  const t = useTranslations("stats.reviews");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [rating, setRating] = useState("");
  const [count, setCount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation(
    trpc.stats.recordReviewScore.mutationOptions({
      onSuccess: () => {
        setRating("");
        setCount("");
        showToast({ message: t("saved"), tone: "success" });
        onSaved();
      },
      onError: (e) => setProblem(errorText(e)),
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = parseScore(rating);
    const c = count.trim() === "" ? null : Number(count.trim());
    if (
      (r !== null && (Number.isNaN(r) || r > source.scale)) ||
      (c !== null && (!Number.isInteger(c) || c < 0)) ||
      (r === null && c === null)
    ) {
      setProblem(t("scoreInvalid", { scale: source.scale }));
      return;
    }
    setProblem(null);
    save.mutate({ sourceId: source.id, rating: r, count: c });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" noValidate>
      <label className="flex w-36 flex-col gap-1 text-sm font-medium">
        {t("score", { scale: source.scale })}
        <input
          className={input}
          inputMode="decimal"
          value={rating}
          onChange={(e) => setRating(e.target.value)}
          placeholder={source.scale === 10 ? "9,4" : "4,9"}
        />
      </label>
      <label className="flex w-36 flex-col gap-1 text-sm font-medium">
        {t("count")}
        <input className={input} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
      </label>
      <Button type="submit" size="md" loading={save.isPending} loadingLabel={t("saving")}>
        {t("saveScore")}
      </Button>
      {problem ? (
        <p role="alert" className="text-danger w-full text-sm font-medium">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

function SourceRow({
  source,
  year,
  googleReady,
  onChanged,
}: {
  source: ReviewSourceData;
  year: number;
  googleReady: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("stats.reviews");
  const tChannel = useTranslations("channel");
  const locale = useLocale() as UiLocale;
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation(
    trpc.stats.removeReviewSource.mutationOptions({
      onSuccess: onChanged,
      onError: (e) => showToast({ message: errorText(e), tone: "danger" }),
    }),
  );
  const number = (v: number, digits: number) =>
    new Intl.NumberFormat(locale === "el" ? "el-GR" : "en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  const latest = source.latest;
  const platformName = source.platform === "google" ? t("google") : tChannel(source.platform);
  const newThisYear =
    latest?.count != null && source.yearStart?.count != null ? latest.count - source.yearStart.count : null;

  return (
    <li className="border-border rounded-card flex flex-col gap-3 border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-lg font-semibold">{source.label ?? platformName}</span>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="text-accent flex items-center gap-1 text-sm font-medium underline"
          >
            {t("open", { platform: platformName })}
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        </div>
        <div className="flex items-center gap-2">
          {confirming ? (
            <>
              <Button
                size="md"
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate({ id: source.id })}
              >
                {t("removeConfirm")}
              </Button>
              <Button size="md" variant="ghost" onClick={() => setConfirming(false)}>
                {t("keep")}
              </Button>
            </>
          ) : (
            <Button size="md" variant="ghost" icon={Trash2} onClick={() => setConfirming(true)}>
              {t("remove")}
            </Button>
          )}
        </div>
      </div>

      {latest ? (
        <dl className="grid grid-cols-3 gap-3 phone:grid-cols-1">
          <div>
            <dt className="text-text-muted text-sm">{t("scoreNow")}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2">
              <span className="flex items-center gap-1 text-2xl font-bold tabular-nums">
                <Star size={24} className="fill-current" aria-hidden="true" />
                {latest.rating === null
                  ? t("noScore")
                  : t("scoreOf", { value: number(latest.rating, 2), scale: source.scale })}
              </span>
              <Delta now={latest.rating} before={source.yearAgo?.rating ?? null} kind="number" />
            </dd>
          </div>
          <div>
            <dt className="text-text-muted text-sm">{t("countNow")}</dt>
            <dd className="text-2xl font-bold tabular-nums">{latest.count ?? t("noScore")}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-sm">{t("newThisYear", { year })}</dt>
            <dd className="text-2xl font-bold tabular-nums">{newThisYear ?? t("noScore")}</dd>
          </div>
          <p className="text-text-muted col-span-full text-sm">
            {t(latest.origin === "google" ? "readOn" : "typedOn", { day: formatDay(latest.takenOn, locale, true) })}
          </p>
        </dl>
      ) : (
        <p className="text-text-muted">{t("noScoreYet")}</p>
      )}

      {source.latestReviews.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-base font-semibold">{t("latestReviews")}</h4>
          <ul className="flex flex-col gap-2">
            {source.latestReviews.map((r, i) => (
              <li key={i} className="bg-surface-muted rounded-sm p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span>{r.author ?? t("anonymous")}</span>
                  {r.rating !== null ? (
                    <span
                      role="img"
                      className="text-text flex items-center gap-1"
                      aria-label={t("stars", { value: r.rating })}
                    >
                      {Array.from({ length: Math.round(r.rating) }, (_, s) => (
                        <Star key={s} size={16} className="fill-current" aria-hidden="true" />
                      ))}
                    </span>
                  ) : null}
                  {r.publishedAt ? (
                    <span className="text-text-muted font-normal">
                      {formatDay(r.publishedAt.slice(0, 10) as IsoDate, locale, true)}
                    </span>
                  ) : null}
                </p>
                {r.text ? <p className="mt-1 text-base whitespace-pre-line">{r.text}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {source.platform === "google" && googleReady ? (
        <p className="text-text-muted text-sm">{t("googleAuto")}</p>
      ) : (
        <>
          {source.platform === "google" ? <p className="text-text-muted text-sm">{t("googleNoKey")}</p> : null}
          <ScoreForm source={source} onSaved={onChanged} />
        </>
      )}
    </li>
  );
}

function AddSourceForm({ onAdded }: { onAdded: () => void }) {
  const t = useTranslations("stats.reviews");
  const tChannel = useTranslations("channel");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [platform, setPlatform] = useState<Platform>("airbnb");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = useMutation(
    trpc.stats.addReviewSource.mutationOptions({
      onSuccess: () => {
        setUrl("");
        setLabel("");
        setProblem(null);
        onAdded();
      },
      onError: (e) => setProblem(errorText(e)),
    }),
  );
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim().length < 8) {
          setProblem(t("linkInvalid"));
          return;
        }
        add.mutate({ platform, url: url.trim(), label: label.trim() || null, roomId: null });
      }}
      className="border-border flex flex-col gap-3 border-t pt-4"
    >
      <h4 className="text-base font-semibold">{t("addTitle")}</h4>
      <div className="grid grid-cols-[10rem_1fr_14rem] gap-3 phone:grid-cols-1">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("platform")}
          <select className={input} value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p === "google" ? t("google") : tChannel(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("link")}
          <input
            className={input}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t(`linkExample.${platform}`)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("label")}
          <input className={input} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      {problem ? (
        <p role="alert" className="text-danger text-sm font-medium">
          {problem}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" size="md" icon={Plus} loading={add.isPending}>
          {t("add")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Review scores from Airbnb, Booking.com and Google. Google pages are read automatically once a
 * day when the server has a Google key; Airbnb and Booking.com do not let apps read their
 * reviews, so their score is typed in from the linked page.
 */
export function ReviewsCard({ year, today }: { year: number; today: IsoDate }) {
  const t = useTranslations("stats.reviews");
  const locale = useLocale();
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery(trpc.stats.reviews.queryOptions({ year }));
  const refreshed = useRef(false);
  const refresh = useMutation(
    trpc.stats.refreshGoogle.mutationOptions({
      // A background refresh: when it fails, the stored scores stay on screen and nobody needs a message.
      meta: { handlesErrors: true },
      onSuccess: (r) => {
        if (r.updated > 0) void queryClient.invalidateQueries({ queryKey: trpc.stats.reviews.pathKey() });
      },
    }),
  );
  const changed = () => void queryClient.invalidateQueries({ queryKey: trpc.stats.reviews.pathKey() });

  const data = query.data;
  const stale =
    data?.googleReady === true &&
    data.sources.some((s) => s.platform === "google" && !(s.latest?.origin === "google" && s.latest.takenOn === today));
  const { mutate } = refresh;
  useEffect(() => {
    if (!stale || refreshed.current) return;
    refreshed.current = true;
    mutate({ language: locale === "en" ? "en" : "el" });
  }, [stale, mutate, locale]);

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Star size={24} aria-hidden="true" />
          {t("title")}
        </span>
      }
    >
      <p className="text-text-muted">{t("intro")}</p>
      {query.error && !data ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <Skeleton variant="block" className="h-32" />
      ) : (
        <>
          {data.sources.length === 0 ? (
            <p className="font-medium">{t("empty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.sources.map((s) => (
                <SourceRow key={s.id} source={s} year={year} googleReady={data.googleReady} onChanged={changed} />
              ))}
            </ul>
          )}
          {refresh.isPending ? (
            <p className="text-text-muted text-sm" aria-live="polite">
              {t("googleReading")}
            </p>
          ) : null}
          <AddSourceForm onAdded={changed} />
        </>
      )}
    </Card>
  );
}

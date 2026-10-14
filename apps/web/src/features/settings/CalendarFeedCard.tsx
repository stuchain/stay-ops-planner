import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Copy, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { fieldClass } from "@/ui/field";
import { Button, buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Skeleton } from "@/ui/Skeleton";

type Confirm = "renew" | "remove" | null;

/** The addresses calendar apps subscribe with, from the feed path the server gives. */
export function feedLinks(path: string, origin: string): { https: string; webcal: string; google: string } {
  const https = new URL(path, origin).toString();
  const webcal = https.replace(/^https?:/, "webcal:");
  return { https, webcal, google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}` };
}

const linkButton = cn(buttonBase, buttonVariants.secondary, buttonSizes.lg);

/** Settings > Ημερολόγιο στο κινητό: a private calendar address with the steps for iPhone and Google. */
export function CalendarFeedCard() {
  const t = useTranslations("settingsScreen.calendarFeed");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [copied, setCopied] = useState(false);
  const feed = useQuery(trpc.me.calendarFeed.queryOptions());
  const refresh = () => {
    setConfirm(null);
    setCopied(false);
    void queryClient.invalidateQueries({ queryKey: trpc.me.calendarFeed.queryKey() });
  };
  const create = useMutation(
    trpc.me.createCalendarFeed.mutationOptions({ onSuccess: refresh, meta: { handlesErrors: true } }),
  );
  const remove = useMutation(
    trpc.me.removeCalendarFeed.mutationOptions({ onSuccess: refresh, meta: { handlesErrors: true } }),
  );
  const error = create.error ?? remove.error ?? feed.error;

  const path = feed.data && typeof feed.data.path === "string" ? feed.data.path : null;
  const links = path && typeof window !== "undefined" ? feedLinks(path, window.location.origin) : null;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // No clipboard access (an old browser or a page not in focus): the address stays selectable in the box.
      setCopied(false);
    }
  }

  return (
    <Card title={t("title")}>
      <p className="text-base">{t("intro")}</p>
      {feed.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : !links ? (
        <div>
          <Button
            variant="secondary"
            size="lg"
            icon={CalendarPlus}
            loading={create.isPending}
            loadingLabel={t("creating")}
            onClick={() => create.mutate()}
          >
            {t("create")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <label htmlFor={inputId} className="text-base font-medium">
              {t("linkLabel")}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={inputId}
                readOnly
                value={links.https}
                onFocus={(e) => e.currentTarget.select()}
                className={cn(fieldClass, "w-full max-w-md")}
              />
              <Button size="lg" icon={Copy} onClick={() => void copy(links.https)}>
                {t("copy")}
              </Button>
            </div>
            {copied ? (
              <p role="status" className="text-success-text text-sm font-medium">
                {t("copied")}
              </p>
            ) : null}
            <p className="text-text-muted text-sm">{t("secret")}</p>
          </div>

          <section className="flex flex-col gap-2">
            <h4 className="text-base font-semibold">{t("iphoneTitle")}</h4>
            <p className="text-base">{t("iphoneSteps")}</p>
            <div>
              <a href={links.webcal} className={linkButton}>
                <CalendarPlus size={24} aria-hidden="true" />
                {t("iphoneButton")}
              </a>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h4 className="text-base font-semibold">{t("googleTitle")}</h4>
            <p className="text-base">{t("googleSteps")}</p>
            <div>
              <a href={links.google} target="_blank" rel="noreferrer" className={linkButton}>
                <CalendarPlus size={24} aria-hidden="true" />
                {t("googleButton")}
              </a>
            </div>
          </section>

          <p className="text-text-muted text-base">{t("freshness")}</p>

          {confirm ? (
            <div role="alert" className="bg-warning-soft flex flex-col gap-3 rounded-sm p-4">
              <p className="text-base font-medium">{confirm === "renew" ? t("confirmRenew") : t("confirmRemove")}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={confirm === "remove" ? "danger" : "primary"}
                  size="lg"
                  loading={create.isPending || remove.isPending}
                  onClick={() => (confirm === "renew" ? create.mutate() : remove.mutate())}
                >
                  {t("yes")}
                </Button>
                <Button size="lg" onClick={() => setConfirm(null)}>
                  {t("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="lg" icon={RefreshCw} onClick={() => setConfirm("renew")}>
                {t("renew")}
              </Button>
              <Button size="lg" variant="ghost" icon={Trash2} onClick={() => setConfirm("remove")}>
                {t("remove")}
              </Button>
            </div>
          )}
        </div>
      )}
      {error ? (
        <p role="alert" className="bg-danger-soft text-text rounded-sm p-4 text-base font-medium">
          {errorText(error)}
        </p>
      ) : null}
    </Card>
  );
}

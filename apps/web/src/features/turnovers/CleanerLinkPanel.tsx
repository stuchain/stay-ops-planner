"use client";

import { useMutation } from "@tanstack/react-query";
import { Copy, MessageCircle, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { formatDay, type UiLocale } from "@/ui/format";
import { showToast } from "@/ui/Toast";

export type CleanerLink = { day: IsoDate; url: string; expiresOn: IsoDate };

/** The address to send for one day's link, ready to copy or open in WhatsApp. */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * "Στείλτε το πρόγραμμα στην καθαρίστρια": the person picks one of the days on screen that has cleanings, and
 * gets a read-only link for that day (the server makes links one day at a time) to copy or send by WhatsApp.
 */
export function CleanerLinkPanel({
  days,
  dayLabel,
  onClose,
}: {
  /** The days on screen that have something to clean, in order. */
  days: IsoDate[];
  /** "Σήμερα", "Αύριο" or the short date. */
  dayLabel: (day: IsoDate) => string;
  onClose: () => void;
}) {
  const t = useTranslations("turnovers.link");
  const locale = useLocale() as UiLocale;
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [link, setLink] = useState<CleanerLink | null>(null);
  const createLink = useMutation(trpc.cleaning.createLink.mutationOptions({ meta: { handlesErrors: true } }));

  async function makeLink(day: IsoDate) {
    try {
      const result = await createLink.mutateAsync({ day });
      setLink({
        day,
        url: `${window.location.origin}${result.path}`,
        expiresOn: result.expiresAt.slice(0, 10) as IsoDate,
      });
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      showToast({ message: t("copied"), tone: "success" });
    } catch {
      showToast({ message: t("copyFailed"), tone: "warning" });
    }
  }

  const pending = createLink.isPending ? createLink.variables?.day : undefined;

  return (
    <section
      aria-label={t("open")}
      data-testid="cleaner-link-panel"
      className="bg-accent-soft rounded-card flex flex-col gap-4 p-4 print:hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-semibold">{days.length > 0 ? t("whichDay") : t("noDays")}</p>
        <Button variant="ghost" icon={X} onClick={onClose}>
          {t("close")}
        </Button>
      </div>
      {days.length > 0 ? (
        <div role="group" aria-label={t("whichDay")} className="flex flex-wrap gap-2">
          {days.map((day) => (
            <Button
              key={day}
              size="lg"
              variant={link?.day === day ? "primary" : "secondary"}
              aria-pressed={link?.day === day}
              loading={pending === day}
              loadingLabel={t("creating")}
              onClick={() => void makeLink(day)}
            >
              {dayLabel(day)}
            </Button>
          ))}
        </div>
      ) : null}
      {link ? (
        <div className="flex flex-col gap-3">
          <p className="text-base">
            {t("ready", { day: formatDay(link.day, locale), date: formatDay(link.expiresOn, locale, true) })}
          </p>
          <input
            readOnly
            aria-label={t("field")}
            value={link.url}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-target border-border bg-surface text-text w-full rounded-sm border px-3 py-2 text-base"
          />
          <div className="flex flex-wrap gap-3">
            <Button size="lg" variant="primary" icon={Copy} onClick={() => void copy(link.url)}>
              {t("copy")}
            </Button>
            <a
              href={whatsappUrl(t("whatsappText", { date: formatDay(link.day, locale), url: link.url }))}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg)}
            >
              <MessageCircle size={24} aria-hidden="true" />
              {t("whatsapp")}
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}

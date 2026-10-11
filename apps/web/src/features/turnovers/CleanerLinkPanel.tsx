"use client";

import { Copy, MessageCircle, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { IsoDate } from "@stay-ops/domain";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { formatDay, type UiLocale } from "@/ui/format";
import { showToast } from "@/ui/Toast";

export type CleanerLink = { url: string; expiresOn: IsoDate };

/** The address to send for one day's link, ready to copy or open in WhatsApp. */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function CleanerLinkPanel({ day, link, onClose }: { day: IsoDate; link: CleanerLink; onClose: () => void }) {
  const t = useTranslations("turnovers.link");
  const locale = useLocale() as UiLocale;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      showToast({ message: t("copied"), tone: "success" });
    } catch {
      showToast({ message: t("copyFailed"), tone: "warning" });
    }
  }

  return (
    <div className="bg-accent-soft rounded-card flex flex-col gap-3 p-4 print:hidden">
      <p className="text-base">{t("ready", { date: formatDay(link.expiresOn, locale, true) })}</p>
      <input
        readOnly
        aria-label={t("field")}
        value={link.url}
        onFocus={(event) => event.currentTarget.select()}
        className="min-h-target border-border bg-surface text-text w-full rounded-sm border px-3 py-2 text-base"
      />
      <div className="flex flex-wrap gap-3">
        <Button size="lg" variant="primary" icon={Copy} onClick={() => void copy()}>
          {t("copy")}
        </Button>
        <a
          href={whatsappUrl(t("whatsappText", { date: formatDay(day, locale), url: link.url }))}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg)}
        >
          <MessageCircle size={24} aria-hidden="true" />
          {t("whatsapp")}
        </a>
        <Button size="lg" variant="ghost" icon={X} onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </div>
  );
}

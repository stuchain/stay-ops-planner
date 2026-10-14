"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useTRPC } from "@/api/client";
import type { CalendarBooking } from "@/api/types";
import {
  MESSAGE_KINDS,
  MESSAGE_LANGUAGES,
  type MessageKind,
  type MessageLanguage,
} from "@/i18n/guestMessages/defaults";
import { defaultLanguage, fillTemplate, resolveTemplate, whatsappUrl } from "@/i18n/guestMessages/fill";
import { Button, buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";
import { ChoiceGroup } from "../settings/ChoiceGroup";

export type GuestMessageProps = {
  booking: CalendarBooking;
  /** The apartment's name, or null while the booking has none. */
  roomName: string | null;
  phone: string | null;
};

/**
 * Inside the panel's "Στείλτε μήνυμα" row: a ready message for the guest (welcome, directions, Wi-Fi, check-in)
 * to copy or send on WhatsApp. The language starts from the phone: Greek for +30, English for other countries.
 */
export function GuestMessage({ booking, roomName, phone }: GuestMessageProps) {
  const t = useTranslations("guestMessage");
  const trpc = useTRPC();
  const templates = useQuery(trpc.booking.messageTemplates.queryOptions());
  const [kind, setKind] = useState<MessageKind>("welcome");
  const [lang, setLang] = useState<MessageLanguage>(() => defaultLanguage(phone));
  const roomId = booking.assignment?.roomId ?? null;

  const text = useMemo(() => {
    if (!templates.data) return "";
    const template = resolveTemplate(templates.data.overrides, kind, lang, roomId);
    return fillTemplate(
      template,
      {
        guestName: booking.guestName,
        checkin: booking.checkin,
        checkout: booking.checkout,
        nights: booking.nights,
        apartment: roomName,
        partySize: booking.partySize,
      },
      lang,
    );
  }, [templates.data, kind, lang, roomId, booking, roomName]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ message: t("copied"), tone: "success" });
    } catch {
      showToast({ message: t("copyFailed"), tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ChoiceGroup
        label={t("kindLabel")}
        value={kind}
        choices={MESSAGE_KINDS.map((value) => ({ value, label: t(`kind.${value}`) }))}
        onChange={setKind}
      />
      <ChoiceGroup
        label={t("languageLabel")}
        value={lang}
        choices={MESSAGE_LANGUAGES.map((value) => ({ value, label: t(`lang.${value}`) }))}
        onChange={setLang}
      />
      {templates.data ? (
        <>
          <textarea
            readOnly
            aria-label={t("textLabel")}
            value={text}
            rows={Math.min(14, Math.max(5, text.split("\n").length + 1))}
            className="border-border bg-surface-muted text-text rounded-sm border p-3 text-base"
          />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" size="lg" icon={Copy} onClick={() => void copy()}>
              {t("copy")}
            </Button>
            <a
              href={whatsappUrl(phone, text)}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonBase, buttonVariants.secondary, buttonSizes.lg)}
            >
              <MessageCircle size={24} aria-hidden="true" />
              {t("whatsapp")}
            </a>
          </div>
          {phone === null ? <p className="text-text-muted text-sm">{t("noPhone")}</p> : null}
        </>
      ) : templates.error ? (
        <p className="text-text-muted">{t("loadFailed")}</p>
      ) : (
        <Skeleton variant="block" className="h-40" />
      )}
    </div>
  );
}

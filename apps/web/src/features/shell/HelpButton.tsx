"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Sentry from "@sentry/nextjs";
import { useMutation } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { useTRPC } from "@/api/client";
import { useOnline } from "@/api/online";
import { useErrorText } from "@/api/errors";
import { lastShownError, rememberError } from "@/api/lastError";
import { Button } from "@/ui/Button";
import { showToast } from "@/ui/Toast";

function portalContainer(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  return document.getElementById("new-ui-root") ?? document.body;
}

/** What the browser can tell Stelios about where the person is. */
function pageContext() {
  const root = document.getElementById("new-ui-root");
  return {
    page: `${window.location.pathname}${window.location.search}`.slice(0, 500),
    userAgent: navigator.userAgent.slice(0, 400),
    viewport: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
    textSize: root?.dataset.textSize ?? null,
  };
}

/** "Στείλε στον Στέλιο" (P4-11): one button that e-mails Stelios the page, the last error and the Sentry id. */
export function HelpButton() {
  const t = useTranslations("help");
  const tOffline = useTranslations("offline");
  const online = useOnline();
  const offlineText = online ? null : tOffline("changesOff");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const send = useMutation(trpc.help.send.mutationOptions({ meta: { handlesErrors: true } }));

  // Crashes that never reached an error message on screen still count as "the last error".
  useEffect(() => {
    const onError = (event: ErrorEvent) => rememberError(event.message || "window error");
    const onRejection = (event: PromiseRejectionEvent) =>
      rememberError(event.reason instanceof Error ? event.reason.message : "unhandled rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const lastError = open ? lastShownError() : null;

  async function onSend() {
    try {
      const result = await send.mutateAsync({
        message,
        lastError: lastShownError(),
        sentryEventId: Sentry.lastEventId() ?? null,
        ...pageContext(),
      });
      if (result.status === "sent") {
        showToast({ message: t("sent"), tone: "success" });
        setMessage("");
        setOpen(false);
      } else {
        showToast({ message: t("notSent"), tone: "danger" });
      }
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" icon={LifeBuoy} className="w-full justify-start">
          {t("button")}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal container={portalContainer()}>
        <Dialog.Overlay className="bg-text/40 fixed inset-0 z-50" />
        <Dialog.Content
          aria-describedby={`${ids}-text`}
          className="bg-surface text-text shadow-raised rounded-card fixed top-1/2 left-1/2 z-50 flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 p-6"
        >
          <Dialog.Title className="text-xl font-semibold">{t("title")}</Dialog.Title>
          <p id={`${ids}-text`} className="text-base">
            {t("text")}
          </p>
          <label htmlFor={`${ids}-message`} className="text-base font-semibold">
            {t("messageLabel")}
          </label>
          <textarea
            id={`${ids}-message`}
            rows={4}
            maxLength={2000}
            value={message}
            placeholder={t("messagePlaceholder")}
            onChange={(e) => setMessage(e.target.value)}
            className="border-border bg-surface text-text rounded-sm border px-4 py-3 text-base"
          />
          {lastError ? <p className="text-text-muted text-sm">{t("lastError", { error: lastError.text })}</p> : null}
          {offlineText ? <p className="text-base font-medium">{offlineText}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              size="lg"
              loading={send.isPending}
              disabled={!online}
              onClick={() => void onSend()}
            >
              {t("send")}
            </Button>
            <Dialog.Close asChild>
              <Button size="lg">{t("cancel")}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

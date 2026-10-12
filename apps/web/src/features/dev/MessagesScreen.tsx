"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { MessageTemplatesData } from "@/api/types";
import {
  MESSAGE_KINDS,
  MESSAGE_LANGUAGES,
  PLACEHOLDERS,
  type MessageKind,
  type MessageLanguage,
} from "@/i18n/guestMessages/defaults";
import { fillTemplate, resolveTemplate, sampleContext } from "@/i18n/guestMessages/fill";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ConfirmButton } from "@/ui/ConfirmButton";
import { ErrorState } from "@/ui/ErrorState";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";
import { ChoiceGroup } from "../settings/ChoiceGroup";

const SCOPE_ALL = "all";

type Props = { data: MessageTemplatesData };

function Editor({ data }: Props) {
  const t = useTranslations("dev.messages");
  const tKind = useTranslations("guestMessage.kind");
  const tLang = useTranslations("guestMessage.lang");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const apartments = useQuery(trpc.dev.apartments.list.queryOptions());
  const field = useRef<HTMLTextAreaElement>(null);

  const [kind, setKind] = useState<MessageKind>("welcome");
  const [lang, setLang] = useState<MessageLanguage>("el");
  const [scope, setScope] = useState<string>(SCOPE_ALL);
  /** What the person typed; null while they have not changed the shown text. */
  const [typed, setTyped] = useState<string | null>(null);

  const roomId = scope === SCOPE_ALL ? null : scope;
  const own = data.overrides.find((o) => o.kind === kind && o.lang === lang && o.roomId === roomId);
  const applies = resolveTemplate(data.overrides, kind, lang, roomId);
  const shown = typed ?? applies;
  const dirty = typed !== null && typed.trim() !== applies.trim();
  const apartmentName = apartments.data?.find((a) => a.id === roomId)?.name ?? null;

  const choose = <T,>(set: (value: T) => void) => {
    return (value: T) => {
      set(value);
      setTyped(null);
    };
  };

  const afterChange = (next: MessageTemplatesData) => {
    queryClient.setQueryData(trpc.dev.messageTemplates.queryKey(), next);
    void queryClient.invalidateQueries({ queryKey: trpc.booking.messageTemplates.queryKey() });
    setTyped(null);
  };
  const save = useMutation({
    ...trpc.dev.saveMessageTemplate.mutationOptions(),
    onSuccess: (next) => {
      afterChange(next);
      showToast({ message: t("saved"), tone: "success" });
    },
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
  });
  const reset = useMutation({
    ...trpc.dev.resetMessageTemplate.mutationOptions(),
    onSuccess: (next) => {
      afterChange(next);
      showToast({ message: t("resetDone"), tone: "success" });
    },
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
  });

  function insert(name: string) {
    const box = field.current;
    const token = `{${name}}`;
    const start = box?.selectionStart ?? shown.length;
    const end = box?.selectionEnd ?? shown.length;
    setTyped(shown.slice(0, start) + token + shown.slice(end));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const preview = fillTemplate(shown, sampleContext(lang, apartmentName), lang);
  const status = own
    ? t("usingOwn")
    : roomId !== null && data.overrides.some((o) => o.kind === kind && o.lang === lang && o.roomId === null)
      ? t("usingShared")
      : t("usingDefault");

  return (
    <section className="bg-surface shadow-card rounded-card flex flex-col gap-5 p-5">
      <ChoiceGroup
        label={t("kind")}
        value={kind}
        choices={MESSAGE_KINDS.map((value) => ({ value, label: tKind(value) }))}
        onChange={choose(setKind)}
      />
      <ChoiceGroup
        label={t("language")}
        value={lang}
        choices={MESSAGE_LANGUAGES.map((value) => ({ value, label: tLang(value) }))}
        onChange={choose(setLang)}
      />
      <label className="flex max-w-md flex-col gap-1.5">
        <span className="font-medium">{t("scope")}</span>
        <select
          className="border-border bg-surface min-h-target rounded-sm border px-3 text-base"
          value={scope}
          onChange={(e) => choose(setScope)(e.target.value)}
        >
          <option value={SCOPE_ALL}>{t("scopeAll")}</option>
          {(apartments.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <label htmlFor="message-text" className="font-medium">
          {t("text")}
        </label>
        <textarea
          id="message-text"
          ref={field}
          rows={12}
          value={shown}
          onChange={(e) => setTyped(e.target.value)}
          className="border-border bg-surface text-text w-full rounded-sm border p-3 text-lg leading-relaxed"
        />
        <p className="text-text-muted text-sm">{status}</p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-medium">{t("placeholders")}</h2>
        <ul className="flex flex-wrap gap-2">
          {PLACEHOLDERS.map((name) => (
            <li key={name}>
              <button
                type="button"
                aria-label={t("insert", { name: t(`placeholderHelp.${name}`) })}
                onClick={() => insert(name)}
                className={cn(
                  "border-border bg-surface hover:bg-surface-muted min-h-target flex flex-col items-start rounded-sm border px-3 py-1 text-left",
                )}
              >
                <span className="font-mono font-semibold">{`{${name}}`}</span>
                <span className="text-text-muted text-sm">{t(`placeholderHelp.${name}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-medium">{t("preview")}</h2>
        <p data-testid="preview" className="bg-surface-muted rounded-card p-4 text-lg whitespace-pre-wrap">
          {preview}
        </p>
      </div>

      {dirty ? (
        <p role="status" className="bg-warning-soft text-warning-text rounded-card p-3 font-medium">
          {t("unsaved")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          size="lg"
          icon={Save}
          disabled={!dirty || shown.trim() === ""}
          loading={save.isPending}
          onClick={() => save.mutate({ kind, lang, roomId, text: shown })}
        >
          {t("save")}
        </Button>
        <ConfirmButton
          size="lg"
          icon={RotateCcw}
          disabled={!own}
          loading={reset.isPending}
          question={t("resetConfirm")}
          onConfirm={() => reset.mutate({ kind, lang, roomId })}
        >
          {t("reset")}
        </ConfirmButton>
      </div>
    </section>
  );
}

/** Dev mode: the texts of the guest messages, per kind, language and apartment. */
export function MessagesScreen() {
  const t = useTranslations("dev.messages");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const templates = useQuery(trpc.dev.messageTemplates.queryOptions());
  return (
    <div className="flex flex-col gap-6 p-8 max-[759px]:p-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {templates.data ? (
        <Editor data={templates.data} />
      ) : templates.error ? (
        <ErrorState message={errorText(templates.error)} onRetry={() => void templates.refetch()} />
      ) : (
        <Skeleton variant="block" className="h-96" />
      )}
    </div>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { cents, parseEuroInput, taxFor, type IncomeBasis, type TaxScope } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { TaxRulesEditData } from "@/api/types";
import { compactFieldClass, compactSelectClass } from "@/ui/field";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { formatMoney } from "@/ui/format";
import { IconButton } from "@/ui/IconButton";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";
import {
  addBracket,
  checkDraft,
  draftFromBrackets,
  formatRateInput,
  parseRateInput,
  removeBracket,
  type BracketDraft,
} from "./taxRulesDraft";

const EXAMPLE_INCOME_CENTS = cents(2_000_000);
const input = `${compactFieldClass} tabular-nums`;

function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="min-h-target flex items-center gap-3">
          <input
            type="radio"
            name={name}
            className="size-5"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-text-muted text-sm">
      {children}
    </p>
  );
}

function EditorForm({ data }: { data: TaxRulesEditData }) {
  const t = useTranslations("income.taxEditor");
  const locale = useLocale();
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { year } = data.rules;
  const initial = useMemo(() => draftFromBrackets(data.rules.brackets), [data.rules.brackets]);
  const [brackets, setBrackets] = useState<BracketDraft[]>(initial);
  const [scope, setScope] = useState<TaxScope>(data.rules.scope);
  const [basis, setBasis] = useState<IncomeBasis>(data.rules.incomeBasis);
  const [confirmed, setConfirmed] = useState(data.rules.confirmed);
  const [note, setNote] = useState(data.note ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const money = (cents: number) => formatMoney(cents, locale);

  const check = checkDraft(brackets);
  const errorFor = (index: number, field: "limit" | "rate") =>
    showErrors && !check.ok ? check.errors.find((e) => e.index === index && e.field === field)?.code : undefined;

  const save = useMutation({
    ...trpc.money.setTaxRules.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: trpc.money.taxRules.queryKey({ year }) });
      void queryClient.invalidateQueries({ queryKey: trpc.money.year.pathKey() });
      showToast({ message: t("saved", { year }), tone: "success" });
    },
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!check.ok) {
      setShowErrors(true);
      return;
    }
    const trimmed = note.trim();
    save.mutate({
      year,
      brackets: check.brackets,
      scope,
      incomeBasis: basis,
      confirmed,
      note: trimmed === "" ? null : trimmed,
    });
  }

  function reset() {
    setBrackets(initial);
    setScope(data.rules.scope);
    setBasis(data.rules.incomeBasis);
    setConfirmed(data.rules.confirmed);
    setNote(data.note ?? "");
    setShowErrors(false);
  }

  function setBracket(index: number, patch: Partial<BracketDraft>) {
    setBrackets((all) => all.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  // "From" is the previous limit as typed, so the table reads as a ladder while editing.
  const fromCents = brackets.map((_, i) => {
    if (i === 0) return 0;
    const parsed = parseEuroInput(brackets[i - 1]!.limit);
    return parsed.ok ? parsed.cents : null;
  });
  const example = check.ok ? taxFor(EXAMPLE_INCOME_CENTS, check.brackets) : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <p className={cn("rounded-card p-4", data.saved ? "bg-surface-muted" : "bg-warning-soft text-warning-text")}>
        {data.saved && data.updatedAt
          ? t("lastSaved", {
              date: new Date(data.updatedAt).toLocaleString(locale === "el" ? "el-GR" : "en-GB", {
                dateStyle: "long",
                timeStyle: "short",
                timeZone: "Europe/Athens",
              }),
            })
          : t("notSaved", { year })}
      </p>

      <Card title={t("brackets")}>
        <Hint id="tax-brackets-hint">{t("bracketsHint")}</Hint>
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-base" aria-describedby="tax-brackets-hint">
            <thead>
              <tr className="border-text-muted border-b-2 text-left">
                <th scope="col" className="px-3 py-3 font-bold small:hidden">
                  {t("from")}
                </th>
                <th scope="col" className="px-3 py-3 small:px-2 font-bold">
                  {t("upTo")}
                </th>
                <th scope="col" className="px-3 py-3 small:px-2 font-bold">
                  {t("rate")}
                </th>
                <th scope="col" className="px-3 py-3 small:px-2">
                  <span className="sr-only">{t("actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {brackets.map((b, i) => {
                const n = i + 1;
                const open = i === brackets.length - 1;
                const limitError = errorFor(i, "limit");
                const rateError = errorFor(i, "rate");
                return (
                  <tr key={i} className="border-border border-b align-top">
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums small:hidden">
                      <span className="min-h-target flex items-center">
                        {fromCents[i] === null ? "…" : money(fromCents[i]!)}
                      </span>
                    </td>
                    <td className="px-3 py-3 small:px-2">
                      {open ? (
                        <span className="text-text-muted min-h-target flex items-center">{t("andAbove")}</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <input
                            className={cn(input, "w-36 small:w-28", limitError && "border-danger")}
                            inputMode="decimal"
                            aria-label={t("upToAria", { n })}
                            aria-invalid={limitError ? true : undefined}
                            aria-describedby={limitError ? `tax-limit-${i}-error` : undefined}
                            value={b.limit}
                            onChange={(e) => setBracket(i, { limit: e.target.value })}
                          />
                          {limitError ? (
                            <p id={`tax-limit-${i}-error`} className="text-danger max-w-56 text-sm">
                              {t(limitError)}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 small:px-2">
                      <div className="flex flex-col gap-1">
                        <input
                          className={cn(input, "w-24 small:w-20", rateError && "border-danger")}
                          inputMode="decimal"
                          aria-label={t("rateAria", { n })}
                          aria-invalid={rateError ? true : undefined}
                          aria-describedby={rateError ? `tax-rate-${i}-error` : undefined}
                          value={b.rate}
                          onChange={(e) => setBracket(i, { rate: e.target.value })}
                          onBlur={() => {
                            const bps = parseRateInput(b.rate);
                            if (bps !== null) setBracket(i, { rate: formatRateInput(bps) });
                          }}
                        />
                        {rateError ? (
                          <p id={`tax-rate-${i}-error`} className="text-danger max-w-56 text-sm">
                            {t(rateError)}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 small:px-2 text-right">
                      <IconButton
                        label={t("remove", { n })}
                        icon={Trash2}
                        disabled={brackets.length <= 1}
                        onClick={() => setBrackets((all) => removeBracket(all, i))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <Button icon={Plus} onClick={() => setBrackets((all) => addBracket(all))}>
            {t("add")}
          </Button>
        </div>
        {example ? (
          <p className="text-text-muted">
            {t("example", { income: money(EXAMPLE_INCOME_CENTS), tax: money(example.taxCents) })}
          </p>
        ) : null}
      </Card>

      <Card>
        <div className="grid grid-cols-2 gap-6 phone:grid-cols-1">
          <Choice
            legend={t("scope")}
            name="tax-scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: "total", label: t("scopeTotal") },
              { value: "per_apartment", label: t("scopePerApartment") },
            ]}
          />
          <Choice
            legend={t("basis")}
            name="tax-basis"
            value={basis}
            onChange={setBasis}
            options={[
              { value: "gross", label: t("basisGross") },
              { value: "payout", label: t("basisPayout") },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="min-h-target flex items-center gap-3 font-semibold">
            <input
              type="checkbox"
              className="size-6"
              checked={confirmed}
              aria-describedby="tax-confirmed-hint"
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t("confirmed")}
          </label>
          <Hint id="tax-confirmed-hint">{t("confirmedHint")}</Hint>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="tax-note" className="font-semibold">
            {t("note")}
          </label>
          <textarea
            id="tax-note"
            rows={3}
            maxLength={500}
            aria-describedby="tax-note-hint"
            className="border-border bg-surface rounded-sm border px-3 py-2 text-base"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Hint id="tax-note-hint">{t("noteHint")}</Hint>
        </div>
      </Card>

      {showErrors && !check.ok ? (
        <p role="alert" className="text-danger font-medium">
          {t("fixErrors")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          {t("save")}
        </Button>
        <Button size="lg" onClick={reset}>
          {t("reset")}
        </Button>
      </div>
    </form>
  );
}

/** Dev mode: the tax brackets, scope and income basis the Income page uses, per year. */
export function TaxRulesEditor({ initialYear }: { initialYear: number }) {
  const t = useTranslations("income.taxEditor");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [year, setYear] = useState(initialYear);
  const query = useQuery(trpc.money.taxRules.queryOptions({ year }));
  const years = query.data?.years ?? [year];

  return (
    <div className="flex max-w-4xl flex-col gap-6 p-8 phone:p-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <label className="flex items-center gap-3 text-base font-medium">
            {t("year")}
            <span className="relative">
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={compactSelectClass}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={20}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
              />
            </span>
          </label>
        }
      />
      {query.error ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <Skeleton variant="block" className="h-96" />
      ) : (
        <EditorForm key={`${year}-${String(query.data.updatedAt)}`} data={query.data} />
      )}
    </div>
  );
}

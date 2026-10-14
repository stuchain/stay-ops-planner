"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { parseEuroInput } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { readClientError, useErrorText } from "@/api/errors";
import type { LedgerYearData } from "@/api/types";
import { compactFieldClass } from "@/ui/field";
import { Button } from "@/ui/Button";
import { SidePanel } from "@/ui/SidePanel";
import { showToast } from "@/ui/Toast";

/** Saving, adding and deleting ledger rows; every success refreshes the year. */
export function useLedgerMutations() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const t = useTranslations("income.ledger");
  const errorText = useErrorText();
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.money.year.pathKey() });
  const onError = (error: unknown) => {
    showToast({ message: errorText(error), tone: "danger" });
    if (readClientError(error).code === "BOOKING_CHANGED") void refresh();
  };
  return {
    update: useMutation({
      ...trpc.money.updateRow.mutationOptions(),
      onSuccess: () => {
        showToast({ message: t("saved"), tone: "success" });
        return refresh();
      },
      onError,
    }),
    rename: useMutation({ ...trpc.money.editManualRow.mutationOptions(), onSuccess: refresh, onError }),
    add: useMutation({
      ...trpc.money.addManualRow.mutationOptions(),
      onSuccess: () => {
        showToast({ message: t("manualAdded"), tone: "success" });
        return refresh();
      },
      onError,
    }),
    remove: useMutation({
      ...trpc.money.deleteManualRow.mutationOptions(),
      onSuccess: () => {
        showToast({ message: t("deleted") });
        return refresh();
      },
      onError,
    }),
  };
}

/** Label, control, then hint and error outside the label, so the control's name stays short. */
function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`manual-${id}`} className="font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`manual-${id}-hint`} className="text-text-muted text-sm">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`manual-${id}-error`} className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function ManualRowPanel({
  open,
  onOpenChange,
  ledger,
  saving,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ledger: LedgerYearData;
  saving: boolean;
  onAdd: (input: {
    label: string;
    month: number;
    rentalIndex: number | null;
    amount: number;
    payout: number | null;
  }) => void;
}) {
  const t = useTranslations();
  const [label, setLabel] = useState("");
  const [month, setMonth] = useState(1);
  const [apartment, setApartment] = useState("");
  const [amount, setAmount] = useState("");
  const [payout, setPayout] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!label.trim()) next.label = t("income.ledger.nameRequired");
    const parsedAmount = parseEuroInput(amount);
    if (!parsedAmount.ok) next.amount = t("income.ledger.badAmount");
    const parsedPayout = payout.trim() ? parseEuroInput(payout) : null;
    if (parsedPayout && !parsedPayout.ok) next.payout = t("income.ledger.badAmount");
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsedAmount.ok) return;
    onAdd({
      label: label.trim(),
      month,
      rentalIndex: apartment ? Number(apartment) : null,
      amount: parsedAmount.cents,
      payout: parsedPayout && parsedPayout.ok ? parsedPayout.cents : null,
    });
    setLabel("");
    setAmount("");
    setPayout("");
  }

  const field = `${compactFieldClass} w-full`;
  const described = (key: string, hint?: boolean) =>
    errors[key] ? `manual-${key}-error` : hint ? `manual-${key}-hint` : undefined;
  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      modal
      title={t("income.ledger.manualTitle")}
      description={t("income.ledger.manualDescription")}
    >
      <form id="manual-row-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field id="label" error={errors.label} label={t("income.ledger.manualName")}>
          <input
            id="manual-label"
            className={field}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-invalid={errors.label ? true : undefined}
            aria-describedby={described("label")}
          />
        </Field>
        <Field id="month" error={errors.month} label={t("income.ledger.manualMonth")}>
          <select id="manual-month" className={field} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {t("common.month", { month: i + 1 })}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="apartment"
          error={errors.apartment}
          label={t("income.ledger.manualApartment")}
          hint={t("income.ledger.manualApartmentHint")}
        >
          <select
            id="manual-apartment"
            className={field}
            aria-describedby={described("apartment", true)}
            value={apartment}
            onChange={(e) => setApartment(e.target.value)}
          >
            <option value="">{t("income.ledger.noApartmentOption")}</option>
            {ledger.apartments.map((a) => (
              <option key={a.index} value={a.index}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="amount"
          error={errors.amount}
          label={t("income.ledger.manualAmount")}
          hint={t("income.ledger.manualAmountHint")}
        >
          <input
            id="manual-amount"
            className={field}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={described("amount", true)}
          />
        </Field>
        <Field id="payout" error={errors.payout} label={t("income.ledger.manualPayout")}>
          <input
            id="manual-payout"
            className={field}
            inputMode="decimal"
            value={payout}
            onChange={(e) => setPayout(e.target.value)}
            aria-invalid={errors.payout ? true : undefined}
            aria-describedby={described("payout")}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={saving} icon={Plus}>
          {t("income.ledger.manualAdd")}
        </Button>
      </form>
    </SidePanel>
  );
}

/** "Νέα εγγραφή": the side panel, saved as a manual row (the server dedupes a resent save by its request id). */
export function AddManualRow({
  ledger,
  open,
  onOpenChange,
}: {
  ledger: LedgerYearData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mutations = useLedgerMutations();
  // One id per save: pressing save again with the same row (its answer lost) reuses it, so no second row appears.
  const lastAdd = useRef<{ key: string; requestId: string } | null>(null);
  return (
    <ManualRowPanel
      open={open}
      onOpenChange={onOpenChange}
      ledger={ledger}
      saving={mutations.add.isPending}
      onAdd={(input) => {
        const row = {
          year: ledger.year,
          month: input.month,
          label: input.label,
          // With an apartment the amount goes in its column and counts for tax, like a typed cell in the
          // spreadsheet; without one it is ΜΟΝΟΙ only, which the spreadsheet leaves out of the tax.
          patch:
            input.rentalIndex !== null
              ? {
                  rentalIndex: input.rentalIndex,
                  [`rental${input.rentalIndex}Cents`]: input.amount,
                  payoutCents: input.payout ?? input.amount,
                }
              : { soloCents: input.amount, payoutCents: input.payout ?? input.amount },
        };
        const key = JSON.stringify(row);
        if (lastAdd.current?.key !== key) lastAdd.current = { key, requestId: newRequestId() };
        mutations.add.mutate(
          { ...row, requestId: lastAdd.current.requestId },
          {
            onSuccess: () => {
              lastAdd.current = null;
              onOpenChange(false);
            },
          },
        );
      }}
    />
  );
}

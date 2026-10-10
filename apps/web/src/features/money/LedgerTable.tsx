"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { bucketAmount, parseEuroInput, type IncomeBasis, type LedgerField, type LedgerValues } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { readClientError, useErrorText } from "@/api/errors";
import type { LedgerRowData, LedgerYearData } from "@/api/types";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { formatMoney } from "@/ui/format";
import { SidePanel } from "@/ui/SidePanel";
import { showToast } from "@/ui/Toast";

type CellKind = "text" | "count" | "money" | "apartment";
type Column = { field: LedgerField; kind: CellKind };

/** The accountant's columns, in the spreadsheet's order. */
const COLUMNS: Column[] = [
  { field: "name", kind: "text" },
  { field: "guestCount", kind: "count" },
  { field: "passport", kind: "text" },
  { field: "roomLocation", kind: "text" },
  { field: "dateRange", kind: "text" },
  { field: "nights", kind: "count" },
  { field: "airbnbCents", kind: "money" },
  { field: "bookingCents", kind: "money" },
  { field: "contractCents", kind: "money" },
  { field: "soloCents", kind: "money" },
  { field: "prepaymentCents", kind: "money" },
  { field: "payoutCents", kind: "money" },
  { field: "rentalIndex", kind: "apartment" },
];
const RENTAL_FIELDS = ["rental1Cents", "rental2Cents", "rental3Cents", "rental4Cents"] as const;

type CellValue = string | number | null;

/** The shown and automatic value of one cell. */
function valuesOf(row: LedgerRowData, field: LedgerField, basis: IncomeBasis): { shown: CellValue; auto: CellValue } {
  const rental = RENTAL_FIELDS.indexOf(field as (typeof RENTAL_FIELDS)[number]);
  if (rental >= 0) {
    const autoAmount = row.auto.rentalIndex === rental + 1 ? bucketAmount(row.auto as LedgerValues, basis) : null;
    return { shown: row.shown.rentalCents[rental] ?? null, auto: autoAmount };
  }
  const key = field as keyof LedgerRowData["shown"] & keyof LedgerRowData["auto"];
  return { shown: row.shown[key] as CellValue, auto: row.auto[key] as CellValue };
}

type Editing = { rowKey: string; field: LedgerField; kind: CellKind };

function useLedgerMutations() {
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
        showToast({ message: t("saved"), tone: "success", durationMs: 2500 });
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

type CellEditorProps = {
  row: LedgerRowData;
  basis: IncomeBasis;
  editing: Editing;
  columnLabel: string;
  apartments: LedgerYearData["apartments"];
  saving: boolean;
  onSave: (value: CellValue | "revert") => void;
  onCancel: () => void;
  display: (kind: CellKind, value: CellValue) => string;
};

/** Small form under a cell: type a value, leave it blank on purpose, or go back to Hosthub's value. */
function CellEditor({
  row,
  basis,
  editing,
  columnLabel,
  apartments,
  saving,
  onSave,
  onCancel,
  display,
}: CellEditorProps) {
  const t = useTranslations("income.ledger");
  const locale = useLocale();
  const { shown, auto } = valuesOf(row, editing.field, basis);
  const initial =
    shown === null
      ? ""
      : editing.kind === "money"
        ? formatMoney(shown as number, locale).replace(/\s*€\s*|€/g, "")
        : String(shown);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const corrected = row.overridden.includes(editing.field) || (editing.field === "name" && row.manual);
  useEffect(() => input.current?.focus(), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (editing.kind === "money") {
      const parsed = parseEuroInput(text);
      if (!parsed.ok) return setError(t("badAmount"));
      return onSave(parsed.cents);
    }
    if (editing.kind === "count") {
      if (!/^\d+$/.test(text.trim())) return setError(t("badNumber"));
      return onSave(Number(text.trim()));
    }
    if (editing.kind === "apartment") return onSave(text === "" ? null : Number(text));
    return onSave(text.trim());
  }

  const id = `edit-${row.key}-${editing.field}`;
  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      className="bg-surface border-border shadow-raised absolute top-full left-0 z-20 mt-1 flex w-72 flex-col gap-2 rounded-sm border p-3 text-left font-normal"
    >
      <label htmlFor={id} className="text-sm font-semibold">
        {t("editCell", { column: columnLabel, name: row.shown.name })}
      </label>
      {editing.kind === "apartment" ? (
        <select
          id={id}
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="border-border min-h-target rounded-sm border px-3"
        >
          <option value="">{t("noApartmentOption")}</option>
          {apartments.map((a) => (
            <option key={a.index} value={a.index}>
              {a.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          ref={input}
          value={text}
          inputMode={editing.kind === "text" ? "text" : "decimal"}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="border-border min-h-target rounded-sm border px-3"
        />
      )}
      {error ? (
        <p id={`${id}-error`} className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      {corrected && !row.manual ? (
        <p className="text-text-muted text-sm">
          {t("revertHint", { value: auto === null || auto === "" ? t("emptyValue") : display(editing.kind, auto) })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" loading={saving}>
          {t("save")}
        </Button>
        {!(editing.field === "name" && row.manual) ? (
          <Button onClick={() => onSave(null)} disabled={saving}>
            {t("blank")}
          </Button>
        ) : null}
        {corrected && !row.manual ? (
          <Button onClick={() => onSave("revert")} disabled={saving}>
            {t("revert")}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
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

  const field = "border-border min-h-target w-full rounded-sm border px-3";
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
        <Field id="apartment" error={errors.apartment} label={t("income.ledger.manualApartment")}>
          <select
            id="manual-apartment"
            className={field}
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

/** "Λεπτομέρειες": every row in the accountant's columns, with corrections in place and manual rows. */
export function LedgerTable({ ledger }: { ledger: LedgerYearData }) {
  const t = useTranslations();
  const locale = useLocale();
  const mutations = useLedgerMutations();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const apartmentLabel = (index: number | null) => ledger.apartments.find((a) => a.index === index)?.label ?? "";

  const display = (kind: CellKind, value: CellValue): string => {
    if (value === null || value === "") return "";
    if (kind === "money") return formatMoney(value as number, locale);
    if (kind === "apartment") return apartmentLabel(value as number);
    return String(value);
  };

  const columnLabel = (field: LedgerField) => {
    const rental = RENTAL_FIELDS.indexOf(field as (typeof RENTAL_FIELDS)[number]);
    if (rental >= 0) return ledger.apartments[rental]?.label ?? "";
    return t(`income.ledger.col.${field}` as "income.ledger.col.name");
  };

  function save(row: LedgerRowData, field: LedgerField, value: CellValue | "revert") {
    const done = { onSuccess: () => setEditing(null) };
    if (row.manual && field === "name") {
      if (typeof value !== "string" || !value) return;
      mutations.rename.mutate({ entryId: row.entryId!, expectedVersion: row.version, label: value }, done);
      return;
    }
    mutations.update.mutate(
      {
        target: row.manual ? { entryId: row.entryId! } : { bookingId: row.bookingId! },
        expectedVersion: row.version,
        patch: { [field]: value },
      },
      done,
    );
  }

  function notes(row: LedgerRowData): string[] {
    const out: string[] = [];
    if (row.kind !== "confirmed") out.push(t(`income.ledger.kind.${row.kind}`));
    if (row.counts && row.shown.rentalCents.every((v) => v === null)) out.push(t("income.ledger.noApartment"));
    if (row.hosthubChanged) out.push(t("income.ledger.hosthubChanged"));
    if (row.foreignCurrency) out.push(t("income.ledger.foreign"));
    return out;
  }

  const allColumns: Column[] = [...COLUMNS, ...RENTAL_FIELDS.map((field) => ({ field, kind: "money" as const }))];
  const th = "px-2.5 py-2 text-left font-bold whitespace-nowrap";
  const saving = mutations.update.isPending || mutations.rename.isPending;

  return (
    <Card
      title={t("income.details")}
      actions={
        <Button icon={Plus} onClick={() => setAdding(true)}>
          {t("income.ledger.addManual")}
        </Button>
      }
    >
      <p className="text-text-muted">{t("income.detailsHint")}</p>
      {ledger.rows.length === 0 ? (
        <p>{t("income.empty", { year: ledger.year })}</p>
      ) : (
        <div className="relative overflow-x-auto pb-48">
          <table
            className="w-full border-collapse text-sm"
            aria-label={t("income.ledger.tableLabel", { year: ledger.year })}
          >
            <thead>
              <tr className="border-text-muted border-b-2">
                <th scope="col" className={th}>
                  {t("income.ledger.col.seq")}
                </th>
                {allColumns.map((c) => (
                  <th key={c.field} scope="col" className={cn(th, c.kind === "money" && "text-right")}>
                    {columnLabel(c.field)}
                  </th>
                ))}
                <th scope="col" className={th}>
                  {t("income.ledger.col.note")}
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">{t("income.ledger.col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((row, i) => {
                const struck = row.kind === "cancelled_paid" || row.kind === "cancelled_unpaid";
                return (
                  <tr
                    key={row.key}
                    className={cn("border-border border-b align-top", !row.counts && "text-text-muted")}
                  >
                    <td className="px-2.5 py-1.5 tabular-nums">{i + 1}</td>
                    {allColumns.map((c) => {
                      const { shown } = valuesOf(row, c.field, ledger.rules.incomeBasis);
                      const corrected = row.overridden.includes(c.field);
                      const isEditing = editing?.rowKey === row.key && editing.field === c.field;
                      const text = display(c.kind, shown);
                      return (
                        <td key={c.field} className="relative p-0">
                          <button
                            type="button"
                            onClick={() => setEditing({ rowKey: row.key, field: c.field, kind: c.kind })}
                            aria-label={`${t("income.ledger.editCell", { column: columnLabel(c.field), name: row.shown.name })}${text ? `: ${text}` : ""}${corrected ? `. ${t("income.ledger.corrected")}` : ""}`}
                            className={cn(
                              "hover:bg-surface-muted min-h-target flex w-full items-center gap-1.5 px-2.5 py-1.5 whitespace-nowrap",
                              c.kind === "money" && "justify-end tabular-nums",
                              corrected && "bg-accent-soft",
                              struck && c.field !== "payoutCents" && "line-through",
                            )}
                          >
                            {corrected ? (
                              <span className="bg-accent size-2 shrink-0 rounded-full" aria-hidden="true" />
                            ) : null}
                            {text}
                          </button>
                          {isEditing ? (
                            <CellEditor
                              row={row}
                              basis={ledger.rules.incomeBasis}
                              editing={editing}
                              columnLabel={columnLabel(c.field)}
                              apartments={ledger.apartments}
                              saving={saving}
                              display={display}
                              onCancel={() => setEditing(null)}
                              onSave={(value) => save(row, c.field, value)}
                            />
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="px-2.5 py-1.5">
                      <ul className="flex flex-col gap-0.5">
                        {notes(row).map((note) => (
                          <li key={note} className="whitespace-nowrap">
                            {note}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-1 py-1">
                      {row.manual ? (
                        confirmDelete === row.key ? (
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span>{t("income.ledger.deleteConfirm", { name: row.shown.name })}</span>
                            <Button
                              variant="danger"
                              loading={mutations.remove.isPending}
                              onClick={() =>
                                mutations.remove.mutate(
                                  { entryId: row.entryId!, expectedVersion: row.version },
                                  { onSettled: () => setConfirmDelete(null) },
                                )
                              }
                            >
                              {t("income.ledger.deleteYes")}
                            </Button>
                            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                              {t("income.ledger.cancel")}
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(row.key)}
                            aria-label={t("income.ledger.deleteRow", { name: row.shown.name })}
                            className="hover:bg-surface-muted h-target w-target inline-flex items-center justify-center rounded-sm"
                          >
                            <Trash2 size={20} aria-hidden="true" />
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-text-muted border-t-2 font-bold">
                <th scope="row" className="px-2.5 py-2 text-left" colSpan={10}>
                  {t("income.ledger.totals")}
                </th>
                <td className="px-2.5 py-2 text-right tabular-nums">{formatMoney(ledger.totals.soloCents, locale)}</td>
                <td />
                <td className="px-2.5 py-2 text-right tabular-nums">
                  {formatMoney(ledger.totals.payoutCents, locale)}
                </td>
                <td />
                {ledger.totals.byRentalCents.map((v, i) => (
                  <td key={i} className="px-2.5 py-2 text-right tabular-nums">
                    {formatMoney(v, locale)}
                  </td>
                ))}
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <ManualRowPanel
        open={adding}
        onOpenChange={setAdding}
        ledger={ledger}
        saving={mutations.add.isPending}
        onAdd={(input) =>
          mutations.add.mutate(
            {
              year: ledger.year,
              month: input.month,
              label: input.label,
              patch: {
                soloCents: input.amount,
                payoutCents: input.payout ?? input.amount,
                ...(input.rentalIndex !== null ? { rentalIndex: input.rentalIndex } : {}),
              },
            },
            { onSuccess: () => setAdding(false) },
          )
        }
      />
    </Card>
  );
}

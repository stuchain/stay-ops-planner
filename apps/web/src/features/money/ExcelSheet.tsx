"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { LedgerField } from "@stay-ops/domain";
import type { LedgerYearData } from "@/api/types";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/IconButton";
import { showToast } from "@/ui/Toast";
import { AddManualRow, newRequestId, useLedgerMutations } from "./ledgerEditing";
import {
  cellText,
  cellValues,
  editText,
  parseCell,
  patchFor,
  rowTone,
  sheetAmount,
  sheetLines,
  SHEET_COLUMNS,
  type SheetLine,
} from "./sheetModel";

/** The sheet's own colours, from imerologio-2026-12.xlsx. It stays white paper, like Excel. */
const XL = {
  band: "bg-[#B2A1C7]",
  direct: "bg-[#FFC000]",
  stripe: "bg-[#92D050]",
  cancelled: "bg-[#3F3F3F] text-[#D0D0D0]",
  cancelledName: "bg-[#7F7F7F] text-white",
  red: "text-[#E00000]",
  orange: "text-[#C77700]",
  green: "text-[#00A050]",
  head: "bg-[#EFEFEF] text-[#555555]",
};
const SHEET_FONT: CSSProperties = { fontFamily: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif' };

/** The empty column after the apartments, where his sheet kept the grand total. */
const LAST_LETTER = "R";

const ZOOMS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const ZOOM_KEY = "stayops.money.sheetZoom";

function readZoom(): number {
  try {
    const z = Number(window.localStorage.getItem(ZOOM_KEY));
    return ZOOMS.includes(z) ? z : 1;
  } catch {
    return 1;
  }
}

type Selection = { lineKey: string; col: number };
type Editing = { seed: string | null };

const cell =
  "h-[22px] border-r border-b border-r-[#C6C6C6] border-b-[#9A9A9A] border-dotted px-1 whitespace-nowrap overflow-hidden";
const thickLeft = "border-l-2 border-l-ink";
const thickRight = "border-r-[3px] border-r-ink";
const stickyRn = "sticky left-0 z-[2] w-10 text-center text-xs " + XL.head;
const stickyA = "sticky left-10 z-[2] w-2 p-0 " + XL.stripe;
const stickyB = "sticky left-12 z-[2] text-left border-r-2 border-r-ink";

/** "Σαν το Excel": every booking of the year in the father's spreadsheet layout, typed into like Excel. */
export function ExcelSheet({
  ledger,
  currentMonth,
  onYear,
}: {
  ledger: LedgerYearData;
  /** This month when the year shown is this year, so the sheet opens there. */
  currentMonth: number | null;
  onYear: (year: number) => void;
}) {
  const t = useTranslations();
  const mutations = useLedgerMutations();
  const basis = ledger.rules.incomeBasis;
  const lines = useMemo(() => sheetLines(ledger.rows), [ledger.rows]);
  const cellLines = useMemo(() => lines.filter((l) => l.type !== "month"), [lines]);
  const [sel, setSel] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [zoom, setZoom] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adding, setAdding] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);

  useEffect(() => setZoom(readZoom()), []);

  // Open at this month's band, the way he would scroll his sheet.
  useLayoutEffect(() => {
    if (!currentMonth) return;
    const band = table.current?.querySelector<HTMLElement>(`[data-line-key="month-${currentMonth}"]`);
    const box = scroller.current;
    if (band && box) box.scrollTop = Math.max(0, band.offsetTop - 64 * zoom);
    // Only when the year changes, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger.year]);

  const columnName = (i: number) =>
    i >= 11
      ? (ledger.apartments[i - 11]?.label ?? "")
      : t(`income.sheet.col.${SHEET_COLUMNS[i]!.field}` as "income.sheet.col.name");

  const selLine = sel ? (cellLines.find((l) => l.key === sel.lineKey) ?? null) : null;
  const selColumn = sel ? SHEET_COLUMNS[sel.col]! : null;

  function focusCell(lineKey: string, col: number) {
    const td = table.current?.querySelector<HTMLElement>(`td[data-line-key="${lineKey}"][data-col="${col}"]`);
    td?.focus({ preventScroll: true });
    td?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function select(lineKey: string, col: number) {
    setSel({ lineKey, col });
    setConfirmDelete(false);
    requestAnimationFrame(() => focusCell(lineKey, col));
  }

  function move(dRow: number, dCol: number) {
    if (!sel) return;
    const i = cellLines.findIndex((l) => l.key === sel.lineKey);
    const next = cellLines[Math.max(0, Math.min(cellLines.length - 1, i + dRow))]!;
    select(next.key, Math.max(0, Math.min(SHEET_COLUMNS.length - 1, sel.col + dCol)));
  }

  function startEdit(seed: string | null = null) {
    if (!sel || !selLine) return;
    // A new row starts with its name.
    if (selLine.type === "spare" && sel.col !== 0) {
      setSel({ lineKey: sel.lineKey, col: 0 });
      showToast({ message: t("income.sheet.nameFirst") });
    }
    setEditing({ seed });
  }

  function save(line: SheetLine, col: number, text: string) {
    const column = SHEET_COLUMNS[col]!;
    if (line.type === "month") return;
    if (line.type === "spare") {
      const label = text.trim();
      if (column.kind !== "name" || !label) return;
      mutations.add.mutate({ year: ledger.year, month: line.month, label, requestId: newRequestId() });
      return;
    }
    const row = line.row;
    if (row.manual && column.kind === "name") {
      const label = text.trim();
      if (label && label !== row.shown.name) {
        mutations.rename.mutate({ entryId: row.entryId!, expectedVersion: row.version, label });
      }
      return;
    }
    const parsed = parseCell(column, text, row.manual);
    if (!parsed.ok) {
      showToast({
        message: parsed.error === "badApartment" ? t("income.sheet.badApartment") : t(`income.ledger.${parsed.error}`),
        tone: "danger",
      });
      return;
    }
    const patch = patchFor(row, parsed.values, basis);
    if (Object.keys(patch).length === 0) return;
    mutations.update.mutate({
      target: row.manual ? { entryId: row.entryId! } : { bookingId: row.bookingId! },
      expectedVersion: row.version,
      patch,
    });
  }

  function revert(field: LedgerField) {
    if (selLine?.type !== "row") return;
    const row = selLine.row;
    mutations.update.mutate({
      target: { bookingId: row.bookingId! },
      expectedVersion: row.version,
      patch: { [field]: "revert" },
    });
  }

  function onGridKey(e: KeyboardEvent) {
    if (!sel || editing) return;
    const moves: Record<string, [number, number]> = {
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      Tab: [0, e.shiftKey ? -1 : 1],
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      move(...m);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selLine) {
      e.preventDefault();
      if (!(selLine.type === "row" && selLine.row.manual && sel.col === 0)) save(selLine, sel.col, "");
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      startEdit(e.key);
    }
  }

  function finishEdit(text: string | null, dRow: number, dCol: number) {
    if (sel && selLine && text !== null) save(selLine, sel.col, text);
    setEditing(null);
    if (dRow || dCol) move(dRow, dCol);
    else if (sel) requestAnimationFrame(() => focusCell(sel.lineKey, sel.col));
  }

  function changeZoom(step: number) {
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + step))]!;
    setZoom(next);
    try {
      window.localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // Private window: the size just isn't remembered.
    }
  }

  // Formula bar: where we are, what the cell holds, and Hosthub's value when it was changed by hand.
  const nameBox = sel && selLine && selColumn ? `${selColumn.letter}${selLine.line}` : "";
  const barValue = selLine?.type === "row" && selColumn ? editText(selLine.row, selColumn, basis) : "";
  const selRow = selLine?.type === "row" ? selLine.row : null;
  const changed = selRow && selColumn && !selRow.manual && selRow.overridden.includes(selColumn.field);
  const notes: string[] = [];
  if (selRow) {
    if (selRow.kind !== "confirmed" && selRow.kind !== "manual") notes.push(t(`income.ledger.kind.${selRow.kind}`));
    if (selRow.hosthubChanged) notes.push(t("income.ledger.hosthubChanged"));
    if (selRow.foreignCurrency) notes.push(t("income.ledger.foreign"));
    if (selRow.counts && selRow.shown.rentalCents.every((v) => v === null)) notes.push(t("income.ledger.noApartment"));
  }

  const taxCells =
    ledger.tax.scope === "per_apartment" ? ledger.tax.calculations.map((c) => c.taxCents) : [null, null, null, null];

  return (
    <div className="rounded-card border-border shadow-card flex min-w-0 flex-col overflow-hidden border bg-paper text-ink">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#D4D4D4] bg-[#FAFAFA] p-2" style={SHEET_FONT}>
        <output
          aria-label={t("income.sheet.nameBox")}
          className="w-16 border border-[#C8C8C8] bg-white px-2 py-1 text-center font-bold"
        >
          {nameBox}
        </output>
        <span aria-hidden="true" className="font-serif text-[#777777] italic after:content-['fx']" />
        <output className="min-h-8 min-w-0 flex-[1_1_14rem] truncate border border-[#C8C8C8] bg-white px-2 py-1">
          {barValue}
        </output>
        {changed && selRow && selColumn ? (
          <span className="flex items-center gap-2 rounded-sm bg-[#FFF4D6] px-2 py-1 text-[#6B4B00]">
            {t("income.sheet.fromHosthub", {
              value: (() => {
                const { auto } = cellValues(selRow, selColumn.field, basis);
                if (auto === null || auto === "") return t("income.sheet.empty");
                return selColumn.kind === "money" ? sheetAmount(auto as number) : String(auto);
              })(),
            })}
            <Button onClick={() => revert(selColumn.field)} loading={mutations.update.isPending}>
              {t("income.sheet.revert")}
            </Button>
          </span>
        ) : null}
        {selRow?.manual ? (
          <span className="flex items-center gap-2 rounded-sm bg-[#FFF4D6] px-2 py-1 text-[#6B4B00]">
            {t("income.sheet.manualRow")}
            {confirmDelete ? (
              <>
                <Button
                  variant="danger"
                  loading={mutations.remove.isPending}
                  onClick={() =>
                    mutations.remove.mutate(
                      { entryId: selRow.entryId!, expectedVersion: selRow.version },
                      { onSettled: () => setConfirmDelete(false) },
                    )
                  }
                >
                  {t("income.ledger.deleteYes")}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  {t("income.ledger.cancel")}
                </Button>
              </>
            ) : (
              <Button icon={Trash2} onClick={() => setConfirmDelete(true)}>
                {t("income.sheet.deleteRow")}
              </Button>
            )}
          </span>
        ) : null}
        {notes.length > 0 ? <span className="text-sm text-[#555555]">{notes.join(" · ")}</span> : null}
        <Button icon={Plus} onClick={() => setAdding(true)} className="ml-auto">
          {t("income.ledger.addManual")}
        </Button>
      </div>

      <div
        ref={scroller}
        className="relative max-h-[70vh] overflow-auto overscroll-contain"
        onKeyDown={onGridKey}
        style={SHEET_FONT}
      >
        <table
          ref={table}
          role="grid"
          aria-label={t("income.sheet.tableLabel", { year: ledger.year })}
          className="table-fixed border-separate border-spacing-0 text-[15px] leading-tight tabular-nums"
          style={{ zoom }}
        >
          <colgroup>
            <col style={{ width: 40 }} />
            <col style={{ width: 8 }} />
            {SHEET_COLUMNS.map((c) => (
              <col
                key={c.field}
                // On a phone the name column is narrower, so some amounts show beside it.
                className={c.kind === "name" ? "w-[230px] phone:w-[150px]" : undefined}
                style={c.kind === "name" ? undefined : { width: c.width }}
              />
            ))}
            <col style={{ width: 80 }} />
          </colgroup>
          <thead>
            <tr aria-hidden="true">
              <th className={cn(cell, stickyRn, "sticky top-0 z-[4] border-b-[#C6C6C6] border-solid")} />
              <th className={cn(cell, stickyA, "sticky top-0 z-[4] border-solid")} />
              {SHEET_COLUMNS.map((c, i) => (
                <th
                  key={c.field}
                  className={cn(
                    cell,
                    XL.head,
                    "sticky top-0 z-[3] border-solid text-center text-xs font-normal",
                    i === 0 && "left-12 z-[4]",
                  )}
                >
                  {c.letter}
                </th>
              ))}
              <th className={cn(cell, XL.head, "sticky top-0 z-[3] border-solid text-center text-xs font-normal")}>
                {LAST_LETTER}
              </th>
            </tr>
            <tr>
              <th
                className={cn(cell, stickyRn, "sticky top-[22px] z-[4] h-11 border-b-[3px] border-solid border-b-ink")}
              >
                {1}
              </th>
              <th className={cn(cell, stickyA, "sticky top-[22px] z-[4] border-b-[3px] border-solid border-b-ink")} />
              {SHEET_COLUMNS.map((c, i) => {
                const apartment = i >= 11 ? ledger.apartments[i - 11] : null;
                return (
                  <th
                    key={c.field}
                    scope="col"
                    className={cn(
                      cell,
                      "sticky top-[22px] z-[3] h-11 border-b-[3px] border-solid border-b-ink bg-white pb-1 align-bottom text-[13px] leading-none font-bold whitespace-normal",
                      i === 0 ? cn(stickyB, "z-[4]") : "text-center",
                      c.thick === "left" && thickLeft,
                      c.thick === "right" && thickRight,
                    )}
                  >
                    {apartment ? (
                      <>
                        {i - 10}
                        <span className="block text-[11px] font-normal text-[#555555]">{apartment.label}</span>
                      </>
                    ) : (
                      t(`income.sheet.col.${c.field}` as "income.sheet.col.name")
                    )}
                  </th>
                );
              })}
              <th className={cn(cell, "sticky top-[22px] z-[3] border-b-[3px] border-solid border-b-ink bg-white")} />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              if (line.type === "month") {
                return (
                  <tr key={line.key} data-line-key={line.key}>
                    <th scope="row" className={cn(cell, stickyRn)}>
                      {line.line}
                    </th>
                    <td className={cn(cell, stickyA)} />
                    {SHEET_COLUMNS.map((c, i) => {
                      const sub =
                        c.field === "nights"
                          ? t("income.sheet.band.nights")
                          : c.field === "airbnbCents"
                            ? t("income.sheet.band.airbnb")
                            : c.field === "bookingCents"
                              ? t("income.sheet.band.booking")
                              : c.field === "prepaymentCents"
                                ? t("income.sheet.band.prepayment")
                                : "";
                      return (
                        <td
                          key={c.field}
                          className={cn(
                            cell,
                            i <= 10 ? XL.band : "bg-white",
                            i === 0 && stickyB,
                            i === 1 ? "text-center text-lg font-bold" : "text-center text-[13px]",
                            c.thick === "left" && thickLeft,
                            c.thick === "right" && thickRight,
                          )}
                        >
                          {i === 1 ? t("common.month", { month: line.month }).toLocaleUpperCase("el") : sub}
                        </td>
                      );
                    })}
                    <td className={cell} />
                  </tr>
                );
              }
              const row = line.type === "row" ? line.row : null;
              const tone = row ? rowTone(row) : null;
              return (
                <tr key={line.key} className={cn(tone === "pending" && "text-[#8A8A8A] italic")}>
                  <th scope="row" className={cn(cell, stickyRn)}>
                    {line.line}
                  </th>
                  <td className={cn(cell, stickyA)} />
                  {SHEET_COLUMNS.map((c, i) => {
                    const selected = sel?.lineKey === line.key && sel.col === i;
                    const text = row ? cellText(row, c, basis) : "";
                    const edited = row !== null && !row.manual && row.overridden.includes(c.field);
                    const tint =
                      tone === "direct" && i <= 1
                        ? XL.direct
                        : tone === "cancelled"
                          ? i === 0
                            ? XL.cancelledName
                            : c.field === "prepaymentCents" || c.field === "payoutCents" || i >= 11
                              ? cn("bg-white", i >= 11 && XL.green)
                              : XL.cancelled
                          : "bg-white";
                    const ink =
                      c.field === "payoutCents" && tone === "direct"
                        ? XL.orange
                        : c.field === "payoutCents" && tone === "platform"
                          ? XL.red
                          : c.field === "rentalIndex" && tone === "direct"
                            ? XL.red
                            : "";
                    return (
                      <td
                        key={c.field}
                        data-line-key={line.key}
                        data-col={i}
                        role="gridcell"
                        tabIndex={selected || (!sel && line === cellLines[0] && i === 0) ? 0 : -1}
                        aria-selected={selected}
                        aria-label={`${t("income.sheet.cellLabel", { cell: `${c.letter}${line.line}`, column: columnName(i) })}${text ? `: ${text}` : ""}${edited ? `. ${t("income.ledger.corrected")}` : ""}`}
                        onClick={() => {
                          if (editing) return;
                          if (selected) startEdit();
                          else select(line.key, i);
                        }}
                        className={cn(
                          cell,
                          "relative cursor-cell",
                          tint,
                          ink,
                          i === 0 ? stickyB : "text-center",
                          c.thick === "left" && thickLeft,
                          c.thick === "right" && thickRight,
                          selected && "outline-2 -outline-offset-2 outline-[#217346] outline-solid",
                        )}
                      >
                        {selected && editing ? (
                          <input
                            autoFocus
                            aria-label={t(`income.sheet.col.${c.field}` as "income.sheet.col.name")}
                            defaultValue={editing.seed ?? (row ? editText(row, c, basis) : "")}
                            inputMode={
                              c.kind === "money" || c.kind === "count" || c.kind === "apartment" ? "decimal" : "text"
                            }
                            onFocus={(e) => {
                              if (editing.seed === null) e.currentTarget.select();
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Escape") finishEdit(null, 0, 0);
                              if (e.key === "Enter" || e.key === "Tab") {
                                e.preventDefault();
                                finishEdit(e.currentTarget.value, e.key === "Enter" ? 1 : 0, e.key === "Tab" ? 1 : 0);
                              }
                            }}
                            onBlur={(e) => {
                              if (editing) finishEdit(e.currentTarget.value, 0, 0);
                            }}
                            className="h-5 w-full bg-white px-1 text-inherit shadow-[inset_0_0_0_2px_#217346] outline-none"
                            style={{ textAlign: i === 0 ? "left" : "center" }}
                          />
                        ) : (
                          text
                        )}
                        {edited ? (
                          <span
                            aria-hidden="true"
                            className="absolute top-0 right-0 border-t-[7px] border-l-[7px] border-t-[#E00000] border-l-transparent"
                          />
                        ) : null}
                      </td>
                    );
                  })}
                  <td className={cn(cell, "bg-white")} />
                </tr>
              );
            })}
          </tbody>
          <tfoot className="[&_td]:h-[22px] [&_td]:px-1 [&_td]:text-center [&_td]:whitespace-nowrap">
            <tr className="[&>*]:border-t-2 [&>*]:border-t-ink">
              <th scope="row" className={cn(stickyRn, "border-solid")} />
              <td className={stickyA} />
              <th scope="row" className={cn(stickyB, "px-1 text-[13px] font-normal text-[#555555]")}>
                {t("income.sheet.totals")}
              </th>
              {Array.from({ length: 10 }, (_, i) => (
                <td key={i} />
              ))}
              {ledger.totals.byRentalCents.map((v, i) => (
                <td key={i}>{sheetAmount(v)}</td>
              ))}
              <td className="font-bold">{sheetAmount(ledger.totals.totalCents)}</td>
            </tr>
            <tr>
              <th scope="row" className={stickyRn} />
              <td className={stickyA} />
              <td className={cn(stickyB, "bg-white")} />
              {Array.from({ length: 6 }, (_, i) => (
                <td key={i} />
              ))}
              <td>{sheetAmount(ledger.totals.soloCents)}</td>
              <td />
              <td>{sheetAmount(ledger.totals.payoutCents)}</td>
              {Array.from({ length: 6 }, (_, i) => (
                <td key={i} />
              ))}
            </tr>
            <tr>
              <th scope="row" className={stickyRn} />
              <td className={stickyA} />
              <th scope="row" className={cn(stickyB, "bg-white px-1 text-[13px] font-normal text-[#555555]")}>
                {t("income.sheet.tax")}
              </th>
              {Array.from({ length: 10 }, (_, i) => (
                <td key={i} />
              ))}
              {taxCells.map((v, i) => (
                <td key={i}>{sheetAmount(v)}</td>
              ))}
              <td className={cn("font-bold", XL.red)}>{sheetAmount(ledger.tax.taxCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div
        className="flex flex-wrap items-stretch justify-between gap-2 border-t border-[#D4D4D4] bg-[#F3F3F3]"
        style={SHEET_FONT}
      >
        <div role="group" aria-label={t("income.sheet.years")} className="flex flex-wrap">
          {ledger.years.map((y) => (
            <button
              key={y}
              type="button"
              aria-pressed={y === ledger.year}
              onClick={() => onYear(y)}
              className={cn(
                "min-h-target border-r border-[#D4D4D4] px-4 text-base",
                y === ledger.year
                  ? "bg-white font-bold text-[#217346] shadow-[inset_0_-3px_0_#217346]"
                  : "text-[#333333]",
              )}
            >
              {y}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 px-2">
          <IconButton
            variant="secondary"
            icon={Minus}
            label={t("income.sheet.zoomOut")}
            onClick={() => changeZoom(-1)}
            disabled={zoom === ZOOMS[0]}
          />
          <output aria-live="polite" className="min-w-14 text-center tabular-nums">
            {t("income.sheet.zoomLevel", { percent: Math.round(zoom * 100) })}
          </output>
          <IconButton
            variant="secondary"
            icon={Plus}
            label={t("income.sheet.zoomIn")}
            onClick={() => changeZoom(1)}
            disabled={zoom === ZOOMS[ZOOMS.length - 1]}
          />
        </div>
      </div>
      <p className="border-t border-[#D4D4D4] bg-white px-3 py-2 text-sm text-[#555555]">{t("income.sheet.hint")}</p>

      <AddManualRow ledger={ledger} open={adding} onOpenChange={setAdding} />
    </div>
  );
}

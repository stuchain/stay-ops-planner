"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyOverrides,
  computeTotals,
  hasMeaningfulOverride,
  type LedgerRow,
  type Overrides,
} from "@/modules/excel/ledger";
import { defaultRentalLabels, type RentalLabels } from "@/modules/excel/rentalConfig";
import type { ExcelApiRow } from "@/modules/excel/yearData";
import { BookingDetailModal } from "@/modules/bookings/BookingDetailModal";

type Toast = { kind: "error" | "ok"; message: string } | null;

const COLS: { key: keyof LedgerRow; label: string; numeric?: boolean }[] = [
  { key: "name", label: "ΟΝΟΜΑ" },
  { key: "guestCount", label: "ΑΤΟΜΑ", numeric: true },
  { key: "passport", label: "ΔΙΑΒΑΤΗΡΙΟ" },
  { key: "roomLocation", label: "ROOM LOCATION" },
  { key: "dateRange", label: "ΑΦΙΞΗ - ΑΝΑΧΩΡΗΣΗ" },
  { key: "nights", label: "ΗΜΕΡΕΣ Χ ΤΙΜΗ", numeric: true },
  { key: "airbnbAmount", label: "AIRBNB ΔΩΜ ΠΟΣΟ", numeric: true },
  { key: "bookingAmount", label: "BOOKING ΔΩΜ ΠΟΣΟ", numeric: true },
  { key: "contractAmount", label: "ΣΥΜΒΟ ΠΟΣΟ", numeric: true },
  { key: "soloAmount", label: "ΜΟΝΟΙ ΠΟΣΟ", numeric: true },
  { key: "prepayment", label: "ΠΡΟΚ/ΛΗ", numeric: true },
  { key: "payoutAmount", label: "ΚΑΘΑΡΟ", numeric: true },
  { key: "rentalIndex", label: "ROOM AMA", numeric: true },
  { key: "rental1", label: "1", numeric: true },
  { key: "rental2", label: "2", numeric: true },
  { key: "rental3", label: "3", numeric: true },
  { key: "rental4", label: "4", numeric: true },
];

const RENTAL_COL_KEYS: readonly (keyof LedgerRow)[] = ["rental1", "rental2", "rental3", "rental4"];

function monthFromSortKey(sort: string | null): number {
  if (!sort || sort.length < 7) return 0;
  const m = Number(sort.slice(5, 7));
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m : 0;
}

type RowSeg =
  | { kind: "banner"; month: number; key: string }
  | { kind: "data"; row: ExcelApiRow; rowIdx: number; seq: number; key: string };

function buildRowSegments(rows: ExcelApiRow[]): RowSeg[] {
  const out: RowSeg[] = [];
  let last = 0;
  let seq = 0;
  rows.forEach((row, rowIdx) => {
    const m = monthFromSortKey(row.sortCheckin);
    if (m !== 0 && m !== last) {
      out.push({ kind: "banner", month: m, key: `banner-${m}-${rowIdx}` });
      last = m;
    }
    seq += 1;
    out.push({
      kind: "data",
      row,
      rowIdx,
      seq,
      key: row.entryId ?? row.bookingId ?? `row-${rowIdx}`,
    });
  });
  return out;
}

const MONTH_NAMES_GR = [
  "ΙΑΝΟΥΑΡΙΟΣ",
  "ΦΕΒΡΟΥΑΡΙΟΣ",
  "ΜΑΡΤΙΟΣ",
  "ΑΠΡΙΛΙΟΣ",
  "ΜΑΪΟΣ",
  "ΙΟΥΝΙΟΣ",
  "ΙΟΥΛΙΟΣ",
  "ΑΥΓΟΥΣΤΟΣ",
  "ΣΕΠΤΕΜΒΡΙΟΣ",
  "ΟΚΤΩΒΡΙΟΣ",
  "ΝΟΕΜΒΡΙΟΣ",
  "ΔΕΚΕΜΒΡΙΟΣ",
] as const;

/** One cell per column: seq + detail + COLS (19 columns). Month in passport col; sub-labels aligned to headers. */
function monthBannerCells(month: number): string[] {
  const label = MONTH_NAMES_GR[month - 1] ?? "";
  const base = [
    "",
    "",
    "",
    label,
    "",
    "ΗΜΕΡΕΣ",
    "",
    "AIRBNB",
    "BOOKING",
    "",
    "",
    "ΠΡΟΚ/ΛΗ",
    "ΚΑΘΑΡΟ",
    "",
    "",
    "",
    "",
    "",
  ] as const;
  // Insert empty cell for detail column (after seq, before name).
  return [base[0], "", ...base.slice(1)];
}

function EditableRentalHeader(props: {
  index: 1 | 2 | 3 | 4;
  label: string;
  disabled?: boolean;
  onUpdated: (next: RentalLabels) => void;
  onError: (message: string) => void;
}) {
  const { index, label, disabled, onUpdated, onError } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const skipBlur = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(label);
  }, [label, editing]);

  const commit = async () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === label) return;
    try {
      const res = await fetch("/api/excel/rental-config", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, label: trimmed }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(j?.error?.message ?? j?.message ?? "PATCH rental-config failed");
        return;
      }
      const d = j.data as RentalLabels | undefined;
      if (d) onUpdated(d);
    } catch {
      onError("PATCH rental-config failed");
    }
  };

  return (
    <span className="ops-excel-rental-header-wrap">
      {editing ? (
        <input
          className="ops-excel-rental-header-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            void commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              skipBlur.current = true;
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="ops-excel-rental-header-btn"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setDraft(label);
            setEditing(true);
          }}
        >
          {label}
        </button>
      )}
    </span>
  );
}

function formatDisplayValue(key: keyof LedgerRow, v: string | number | null): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    if (key === "nights" || key === "rentalIndex" || key === "guestCount") return String(v);
    return String(v);
  }
  return String(v);
}

function parseCommit(key: keyof LedgerRow, raw: string, numeric?: boolean): unknown {
  const t = raw.trim();
  if (t === "") return null;
  if (numeric) {
    const n = Number(t.replace(",", "."));
    if (!Number.isFinite(n)) return null;
    if (key === "nights" || key === "rentalIndex" || key === "guestCount") return Math.round(n);
    return n;
  }
  return t;
}

function EditableCell(props: {
  rowIdx: number;
  row: ExcelApiRow;
  field: keyof LedgerRow;
  numeric?: boolean;
  disabled?: boolean;
  saving: boolean;
  onSave: (rowIdx: number, field: keyof LedgerRow, value: unknown) => Promise<void>;
  onRevert: (rowIdx: number, field: keyof LedgerRow) => Promise<void>;
}) {
  const { row, field, numeric, disabled, saving, rowIdx, onSave, onRevert } = props;
  const displayed = applyOverrides(row.auto, row.overrides)[field];
  const autoVal = row.auto[field];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const skipBlurCommit = useRef(false);
  const showRevert = hasMeaningfulOverride(row.auto, row.overrides, field);

  const startEdit = () => {
    if (disabled) return;
    setDraft(formatDisplayValue(field, displayed as never));
    setEditing(true);
  };

  const commit = async () => {
    setEditing(false);
    const next = parseCommit(field, draft, numeric);
    const cur = row.overrides?.[field as keyof Overrides];

    const matchesAuto = (a: unknown, b: unknown): boolean => {
      if (Object.is(a, b)) return true;
      if (typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b)) {
        return Math.abs(a - b) < 1e-9;
      }
      return false;
    };

    if (next === null) {
      if (cur === undefined || cur === null) return;
      await onSave(rowIdx, field, null);
      return;
    }
    if (matchesAuto(next, autoVal)) {
      if (cur === undefined || cur === null) return;
      await onSave(rowIdx, field, null);
      return;
    }
    if (matchesAuto(next, cur)) return;
    await onSave(rowIdx, field, next);
  };

  return (
    <td
      className={`ops-excel-cell ${showRevert ? "ops-excel-cell--override" : ""}`}
      data-field={field}
    >
      {editing ? (
        <input
          className="ops-excel-cell-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (skipBlurCommit.current) {
              skipBlurCommit.current = false;
              return;
            }
            void commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              skipBlurCommit.current = true;
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="ops-excel-cell-display"
          disabled={disabled || saving}
          onClick={startEdit}
        >
          {formatDisplayValue(field, displayed as never)}
        </button>
      )}
      {showRevert ? (
        <button
          type="button"
          className="ops-excel-revert"
          title="Επαναφορά αυτόματης τιμής"
          disabled={saving}
          onClick={() => void onRevert(rowIdx, field)}
        >
          ↺
        </button>
      ) : null}
    </td>
  );
}

export function ExcelClient() {
  const now = new Date();
  const maxYear = now.getUTCFullYear() + 1;
  const minYear = 2024;
  const [year, setYear] = useState(now.getUTCFullYear());
  const [rows, setRows] = useState<ExcelApiRow[]>([]);
  const [rentalLabels, setRentalLabels] = useState<RentalLabels>(() => defaultRentalLabels());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setToast(null);
    try {
      const res = await fetch(`/api/excel?year=${year}`, { credentials: "include" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ kind: "error", message: j?.error?.message ?? j?.message ?? res.statusText });
        setRows([]);
        return;
      }
      setRows(j.data?.rows ?? []);
      const rl = j.data?.rentalLabels as RentalLabels | undefined;
      setRentalLabels(rl && typeof rl === "object" ? rl : defaultRentalLabels());
    } catch {
      setToast({ kind: "error", message: "Αποτυχία φόρτωσης" });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayedRows = useMemo(() => rows.map((r) => applyOverrides(r.auto, r.overrides)), [rows]);
  const totals = useMemo(() => computeTotals(displayedRows), [displayedRows]);

  const ensureEntryId = useCallback(
    async (rowIdx: number): Promise<string | null> => {
      const row = rows[rowIdx];
      if (!row) return null;
      if (row.entryId) return row.entryId;
      if (!row.bookingId) return null;
      const res = await fetch("/api/excel/entries", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "ensure_booking",
          year,
          bookingId: row.bookingId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ kind: "error", message: j?.error?.message ?? j?.message ?? "ensure_booking failed" });
        return null;
      }
      const id = j.data?.entryId as string | undefined;
      if (id) {
        setRows((prev) => {
          const next = [...prev];
          const cur = next[rowIdx];
          if (!cur) return prev;
          next[rowIdx] = { ...cur, entryId: id };
          return next;
        });
      }
      return id ?? null;
    },
    [rows, year],
  );

  const onSave = useCallback(
    async (rowIdx: number, field: keyof LedgerRow, value: unknown) => {
      setSaving(true);
      setToast(null);
      try {
        let entryId = rows[rowIdx]?.entryId ?? null;
        if (!entryId) {
          entryId = await ensureEntryId(rowIdx);
        }
        if (!entryId) {
          setSaving(false);
          return;
        }
        const patch: Overrides = { [field]: value as never } as Overrides;
        const res = await fetch(`/api/excel/entries/${entryId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: patch }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setToast({ kind: "error", message: j?.error?.message ?? j?.message ?? "PATCH failed" });
          return;
        }
        const d = j.data as Partial<ExcelApiRow> | undefined;
        const nextOverrides = (d?.overrides as Overrides | null) ?? null;
        const nextEntryId = d?.entryId ?? null;
        setRows((prev) => {
          const n = [...prev];
          const cur = n[rowIdx];
          if (!cur) return prev;
          n[rowIdx] = {
            ...cur,
            overrides: nextOverrides,
            entryId: nextEntryId ?? cur.entryId,
          };
          return n;
        });
      } finally {
        setSaving(false);
      }
    },
    [ensureEntryId, rows],
  );

  const onRevert = useCallback(
    async (rowIdx: number, field: keyof LedgerRow) => {
      await onSave(rowIdx, field, null);
    },
    [onSave],
  );

  const addManual = async () => {
    const name = window.prompt("Όνομα γραμμής (ΟΝΟΜΑ);", "");
    if (!name?.trim()) return;
    const mStr = window.prompt("Μήνας (1-12);", String(now.getUTCMonth() + 1));
    const m = Number(mStr);
    if (!Number.isFinite(m) || m < 1 || m > 12) {
      setToast({ kind: "error", message: "Άκυρος μήνας" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/excel/entries", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "manual",
          year,
          manualName: name.trim(),
          manualMonth: m,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ kind: "error", message: j?.error?.message ?? j?.message ?? "POST failed" });
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    window.location.assign(`/api/excel/export?year=${year}`);
  };

  const segments = useMemo(() => buildRowSegments(rows), [rows]);

  return (
    <main className="ops-excel-wrap">
      <header className="ops-calendar-header ops-excel-header">
        <h1>Excel</h1>
        <div className="ops-excel-actions">
          <label className="ops-excel-year">
            Έτος{" "}
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              disabled={loading || saving}
            >
              {Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="ops-btn" disabled={saving} onClick={() => void addManual()}>
            Προσθήκη χειροκίνητης γραμμής
          </button>
          <button type="button" className="ops-btn ops-btn-primary" onClick={download}>
            Λήψη .xlsx
          </button>
        </div>
      </header>

      {toast ? (
        <div className={toast.kind === "error" ? "ops-excel-toast ops-excel-toast--error" : "ops-excel-toast"}>
          {toast.message}
        </div>
      ) : null}

      {loading ? (
        <p className="ops-markers">Φόρτωση…</p>
      ) : (
        <div className="ops-excel-scroll">
          <table className="ops-excel-table">
            <thead>
              <tr>
                <th>Α/Α</th>
                <th className="ops-excel-detail-head" scope="col" aria-label="Λεπτομέρειες" />
                {COLS.map((c) => {
                  const ri = RENTAL_COL_KEYS.indexOf(c.key);
                  if (ri >= 0) {
                    const idx = (ri + 1) as 1 | 2 | 3 | 4;
                    const lk = `label${idx}` as keyof RentalLabels;
                    return (
                      <th key={c.key}>
                        <EditableRentalHeader
                          index={idx}
                          label={rentalLabels[lk]}
                          disabled={saving || loading}
                          onUpdated={setRentalLabels}
                          onError={(message) => setToast({ kind: "error", message })}
                        />
                      </th>
                    );
                  }
                  return <th key={c.key}>{c.label}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {segments.map((seg) => {
                if (seg.kind === "banner") {
                  const cells = monthBannerCells(seg.month);
                  return (
                    <tr key={seg.key} className="ops-excel-month-row">
                      {cells.map((text, i) => (
                        <td
                          key={i}
                          className={i === 4 ? "ops-excel-month-title" : "ops-excel-month-subcell"}
                        >
                          {text}
                        </td>
                      ))}
                    </tr>
                  );
                }
                const { row, rowIdx, seq } = seg;
                return (
                  <tr key={seg.key}>
                    <td className="ops-excel-seq">{seq}</td>
                    <td className="ops-excel-detail-cell">
                      {row.bookingId ? (
                        <button
                          type="button"
                          className="ops-excel-detail-btn"
                          title="Λεπτομέρειες κράτησης"
                          aria-label="Λεπτομέρειες κράτησης"
                          onClick={() => setDetailBookingId(row.bookingId)}
                        >
                          <span aria-hidden="true">i</span>
                        </button>
                      ) : null}
                    </td>
                    {COLS.map((c) => (
                      <EditableCell
                        key={c.key}
                        rowIdx={rowIdx}
                        row={row}
                        field={c.key}
                        numeric={c.numeric}
                        saving={saving}
                        onSave={onSave}
                        onRevert={onRevert}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="ops-excel-totals">
              <tr>
                <td colSpan={15} className="ops-excel-totals-label">
                  Σύνολα ανά ενοίκιο (στήλες 1–4)
                </td>
                <td>{totals.sumByRental[0] || ""}</td>
                <td>{totals.sumByRental[1] || ""}</td>
                <td>{totals.sumByRental[2] || ""}</td>
                <td>{totals.sumByRental[3] || ""}</td>
              </tr>
              <tr>
                <td colSpan={18} className="ops-excel-totals-label">
                  Συνολικό (N+O+P+Q)
                </td>
                <td>{totals.grandTotal}</td>
              </tr>
              <tr>
                <td colSpan={18} className="ops-excel-totals-label">
                  Φόρος 45% (9850 + (R−35000)×0,45)
                </td>
                <td>{totals.topBracketTax.toFixed(2)}</td>
              </tr>
              <tr>
                <td colSpan={11} />
                <td className="ops-excel-totals-label">Συν J</td>
                <td>{totals.sumJ}</td>
                <td className="ops-excel-totals-label">Συν L</td>
                <td>{totals.sumL}</td>
                <td colSpan={4} />
              </tr>
              <tr>
                <td colSpan={15} className="ops-excel-totals-label">
                  Φόρος 35% ανά ενοίκιο (1800 + (x−12000)×0,35)
                </td>
                <td>{totals.perRentalBracketTax[0].toFixed(2)}</td>
                <td>{totals.perRentalBracketTax[1].toFixed(2)}</td>
                <td>{totals.perRentalBracketTax[2].toFixed(2)}</td>
                <td>{totals.perRentalBracketTax[3].toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <BookingDetailModal
        bookingId={detailBookingId}
        onClose={() => setDetailBookingId(null)}
        onAfterSave={load}
      />
    </main>
  );
}

"use client";

import type { DryRunResult } from "@stay-ops/shared";
import { Button, ModalShell } from "@/modules/ui";

function jsonPreview(value: unknown, max = 240): string {
  try {
    const s = JSON.stringify(value, null, 0);
    if (s.length <= max) return s;
    return `${s.slice(0, max)}…`;
  } catch {
    return String(value);
  }
}

export type DryRunPreviewModalProps = {
  open: boolean;
  title: string;
  summary: DryRunResult | null;
  busy: boolean;
  executeLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DryRunPreviewModal({
  open,
  title,
  summary,
  busy,
  executeLabel,
  onConfirm,
  onCancel,
}: DryRunPreviewModalProps) {
  return (
    <ModalShell
      open={open}
      title={title}
      titleId="ops-dryrun-title"
      busy={busy}
      onRequestClose={onCancel}
      panelClassName="ops-dryrun-modal"
      headerActions={
        <Button variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
          Close
        </Button>
      }
      footer={
        summary ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!summary} onClick={onConfirm}>
              {executeLabel}
            </Button>
          </>
        ) : null
      }
    >
      {!summary ? (
        <p className="ops-muted">No preview data.</p>
      ) : (
        <>
          <section className="ops-markers">
            <h3>Totals</h3>
            <p className="ops-muted">Processed: {summary.totals.processed}</p>
            <div className="ops-suggestion-card">
              <div className="ops-suggestion-score">By action</div>
              <pre className="ops-dryrun-pre">{jsonPreview(summary.totals.byAction, 400)}</pre>
            </div>
            <div className="ops-suggestion-card">
              <div className="ops-suggestion-score">By entity</div>
              <pre className="ops-dryrun-pre">{jsonPreview(summary.totals.byEntity, 400)}</pre>
            </div>
          </section>
          {summary.warnings.length > 0 ? (
            <section className="ops-markers">
              <h3>Warnings</h3>
              <ul className="ops-dryrun-warnings">
                {summary.warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`} className="ops-error">
                    <strong>{w.code}</strong>: {w.message}
                    {w.details != null ? (
                      <pre className="ops-dryrun-pre">{jsonPreview(w.details, 400)}</pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="ops-markers">
            <h3>Planned changes {summary.truncated ? "(truncated)" : ""}</h3>
            {summary.truncated ? (
              <p className="ops-muted">Showing the first {summary.entries.length} entries only.</p>
            ) : null}
            <div className="ops-dryrun-table-wrap">
              <table className="ops-bookings-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Entity</th>
                    <th>Action</th>
                    <th>Id</th>
                    <th>Before / After</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.entries.map((e) => (
                    <tr key={`${e.index}-${e.entityType}-${e.entityId ?? "x"}`}>
                      <td>{e.index}</td>
                      <td>{e.entityType}</td>
                      <td>{e.action}</td>
                      <td className="ops-muted">{e.entityId ?? "—"}</td>
                      <td>
                        <div className="ops-dryrun-diff">
                          <div>
                            <span className="ops-muted">before</span> <code>{jsonPreview(e.before ?? null)}</code>
                          </div>
                          <div>
                            <span className="ops-muted">after</span> <code>{jsonPreview(e.after ?? null)}</code>
                          </div>
                          {e.warning ? <div className="ops-error">{e.warning}</div> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </ModalShell>
  );
}

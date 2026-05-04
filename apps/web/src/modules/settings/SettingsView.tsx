"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DryRunResult } from "@stay-ops/shared";
import { useI18n } from "@/i18n/I18nProvider";
import { DryRunPreviewModal, useDryRun } from "@/modules/dry-run";
import { HosthubListingsSection } from "@/modules/settings/HosthubListingsSection";
import { ToastBanner } from "@/modules/ui";

type ApiError = { error?: { code?: string; message?: string } };
type HosthubTokenStatus = { configured: boolean; updatedAt: string | null; name: string | null };

type SyncRunRow = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string | null;
  source: string | null;
  statsJson: unknown;
  cursor: string | null;
};

type SyncRunsResponse = { data?: { runs?: SyncRunRow[] } };

type HosthubDiagData = {
  sourceListings: {
    total: number;
    byChannel: Array<{ channel: string; count: number }>;
    sample: Array<{ id: string; channel: string; title: string | null; externalListingId: string }>;
  };
  syncRuns: Array<{
    id: string;
    startedAt: string;
    completedAt: string | null;
    status: string | null;
    source: string | null;
    statsJson: unknown;
    cursor: string | null;
  }>;
  importErrors: Array<{ id: string; code: string | null; message: string; createdAt: string; syncRunId: string }>;
  tokenStatus: HosthubTokenStatus;
  probe?: {
    ok: boolean;
    durationMs: number;
    pageDataLength: number;
    pageSkipped: number;
    hasNextPage: boolean;
    distinctListings: Array<{ channel: string; listingId: string; title: string | null }>;
    error?: { code: string; message: string };
  };
};

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
}

export function SettingsView() {
  const { t, setLocale } = useI18n();
  const reconcileDryRun = useDryRun<Record<string, never>>({
    url: "/api/sync/hosthub/reconcile",
    dryRunQueryParam: true,
  });
  const [dryModalOpen, setDryModalOpen] = useState(false);
  const [drySummary, setDrySummary] = useState<DryRunResult | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [hosthubToken, setHosthubToken] = useState("");
  const [hosthubTokenName, setHosthubTokenName] = useState("");
  const [editingTokenMeta, setEditingTokenMeta] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<HosthubTokenStatus>({
    configured: false,
    updatedAt: null,
    name: null,
  });
  const [runs, setRuns] = useState<SyncRunRow[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [diagData, setDiagData] = useState<HosthubDiagData | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [uiLocaleDraft, setUiLocaleDraft] = useState<"en" | "el">("en");

  const latestHosthubPoll = useMemo(() => runs.find((r) => r.source === "hosthub_poll") ?? null, [runs]);
  const isAdmin = userRole === "admin";

  const loadDiag = useCallback(async (opts?: { probe?: boolean }) => {
    const probe = Boolean(opts?.probe);
    setDiagError(null);
    if (probe) {
      setProbeBusy(true);
    } else {
      setDiagLoading(true);
    }
    try {
      const url = `/api/admin/sync/hosthub/diag${probe ? "?probeHosthub=true" : ""}`;
      const res = await fetch(url, { credentials: "include" });
      const j = (await res.json().catch(() => ({}))) as ApiError & { data?: HosthubDiagData };
      if (!res.ok) {
        throw new Error(j.error?.message ?? `Diagnostics HTTP ${res.status}`);
      }
      if (j.data) {
        setDiagData(j.data);
      }
    } catch (e) {
      setDiagError(e instanceof Error ? e.message : "Diagnostics failed");
      if (probe) {
        setDiagData(null);
      }
    } finally {
      setDiagLoading(false);
      setProbeBusy(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tokenRes, runsRes, meRes] = await Promise.all([
        fetch("/api/admin/integrations/hosthub/token", { credentials: "include" }),
        fetch("/api/sync/runs", { credentials: "include" }),
        fetch("/api/auth/me", { credentials: "include" }),
      ]);

      if (meRes.ok) {
        const meJson = (await meRes.json()) as { data?: { user?: { role?: string; uiLocale?: string } } };
        setUserRole(meJson.data?.user?.role ?? null);
        const uil = meJson.data?.user?.uiLocale;
        if (uil === "en" || uil === "el") {
          setUiLocaleDraft(uil);
          setLocale(uil);
        }
      } else {
        setUserRole(null);
      }

      if (tokenRes.ok) {
        const tokenJson = (await tokenRes.json()) as { data: HosthubTokenStatus };
        setTokenStatus(tokenJson.data);
        if (!editingTokenMeta) {
          setHosthubTokenName(tokenJson.data.name ?? "");
        }
      } else {
        const err = (await tokenRes.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Token HTTP ${tokenRes.status}`);
      }

      if (runsRes.ok) {
        const runsJson = (await runsRes.json()) as SyncRunsResponse;
        setRuns(runsJson.data?.runs ?? []);
      } else {
        const err = (await runsRes.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Sync runs HTTP ${runsRes.status}`);
      }

      await loadDiag({ probe: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [editingTokenMeta, loadDiag, setLocale]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function saveUiLocale() {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uiLocale: uiLocaleDraft }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Save HTTP ${res.status}`);
      }
      setLocale(uiLocaleDraft);
      setFlash(t("settings.languageSaved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.languageError"));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onTick() {
      void loadAll();
    }
    window.addEventListener("ops:hosthub-sync-tick", onTick);
    return () => window.removeEventListener("ops:hosthub-sync-tick", onTick);
  }, [loadAll]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 5200);
    return () => window.clearTimeout(t);
  }, [flash]);

  async function saveToken() {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/integrations/hosthub/token", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: hosthubToken, name: hosthubTokenName || null }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Save HTTP ${res.status}`);
      }
      setHosthubToken("");
      setEditingTokenMeta(false);
      setFlash("Hosthub token saved. Starting sync...");
      await syncNow({ fromSave: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save token");
    } finally {
      setSaving(false);
    }
  }

  const previewSync = useCallback(async () => {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const summary = await reconcileDryRun.preview();
      setDrySummary(summary);
      setDryModalOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setSaving(false);
    }
  }, [reconcileDryRun]);

  const confirmSyncAfterPreview = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await reconcileDryRun.execute();
      setDryModalOpen(false);
      setDrySummary(null);
      setFlash("Sync completed.");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSaving(false);
    }
  }, [reconcileDryRun, loadAll]);

  async function syncNow(opts?: { fromSave?: boolean }) {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/sync/hosthub/reconcile", { method: "POST", credentials: "include" });
      if (res.status === 200) {
        setFlash("Sync completed.");
      } else if (res.status === 202) {
        setFlash(opts?.fromSave ? "Token saved. Sync already running." : "Sync already running.");
      } else if (res.status === 503) {
        setFlash("Hosthub token is not configured.");
      } else {
        const err = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Sync HTTP ${res.status}`);
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSaving(false);
    }
  }

  async function fullSyncNow() {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/sync/hosthub/reconcile", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullSync: true }),
      });
      if (res.status === 200) {
        setFlash("Full sync completed.");
      } else if (res.status === 202) {
        setFlash("Full sync already running.");
      } else if (res.status === 503) {
        setFlash("Hosthub token is not configured.");
      } else {
        const err = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Full sync HTTP ${res.status}`);
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Full sync failed");
    } finally {
      setSaving(false);
    }
  }

  async function resetWatermarkAndSync() {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/sync/hosthub/reset-cursor", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Reset HTTP ${res.status}`);
      }
      setFlash("Sync watermark cleared. Starting full re-sync…");
      await syncNow();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteToken() {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/integrations/hosthub/token", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Delete HTTP ${res.status}`);
      }
      setHosthubToken("");
      setHosthubTokenName("");
      setEditingTokenMeta(false);
      setFlash("Token deleted.");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete token");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="ops-calendar-main">
      <header className="ops-calendar-header">
        <h1>{t("settings.title")}</h1>
      </header>

      {loading && <p className="ops-muted">Loading settings…</p>}
      {error && <p className="ops-error">{error}</p>}
      {flash ? <ToastBanner>{flash}</ToastBanner> : null}

      {!loading && (
        <>
          <section className="ops-markers">
            <h2>{t("settings.language")}</h2>
            <p className="ops-muted">{t("settings.languageHelp")}</p>
            <div className="ops-drawer-row-actions" style={{ alignItems: "center" }}>
              <select
                className="ops-input"
                style={{ maxWidth: "12rem" }}
                value={uiLocaleDraft}
                onChange={(e) => setUiLocaleDraft(e.target.value === "el" ? "el" : "en")}
              >
                <option value="en">English</option>
                <option value="el">Ελληνικά</option>
              </select>
              <button
                type="button"
                className="ops-btn ops-btn-primary"
                disabled={saving}
                onClick={() => void saveUiLocale()}
              >
                {t("settings.saveLanguage")}
              </button>
            </div>
          </section>

          <section className="ops-markers">
            <h2>Hosthub token</h2>
            <p className="ops-muted">
              Status: {tokenStatus.configured ? "configured" : "not configured"}
              {tokenStatus.updatedAt ? ` (updated ${fmtDateTime(tokenStatus.updatedAt)})` : ""}
            </p>
            {tokenStatus.configured && !editingTokenMeta && (
              <div className="ops-suggestion-card">
                <div className="ops-suggestion-score">Saved name: {tokenStatus.name || "Unnamed token"}</div>
                <div className="ops-drawer-row-actions">
                  <button
                    type="button"
                    className="ops-btn"
                    disabled={saving}
                    onClick={() => {
                      setHosthubTokenName(tokenStatus.name ?? "");
                      setEditingTokenMeta(true);
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="ops-btn ops-btn-danger" disabled={saving} onClick={() => void deleteToken()}>
                    Delete
                  </button>
                </div>
              </div>
            )}
            {(!tokenStatus.configured || editingTokenMeta) && (
              <>
                <label className="ops-label">
                  Token name
                  <input
                    className="ops-input"
                    value={hosthubTokenName}
                    onChange={(e) => setHosthubTokenName(e.target.value)}
                    placeholder="e.g. Main account token"
                  />
                </label>
                <label className="ops-label">
                  Hosthub API token
                  <input
                    className="ops-input"
                    type="password"
                    value={hosthubToken}
                    onChange={(e) => setHosthubToken(e.target.value)}
                    placeholder="Paste Hosthub API token"
                  />
                </label>
                <div className="ops-drawer-row-actions">
                  <button
                    type="button"
                    className="ops-btn ops-btn-primary"
                    disabled={saving || hosthubToken.trim().length === 0}
                    onClick={() => void saveToken()}
                  >
                    Save token
                  </button>
                  {tokenStatus.configured && (
                    <button
                      type="button"
                      className="ops-btn"
                      disabled={saving}
                      onClick={() => {
                        setEditingTokenMeta(false);
                        setHosthubToken("");
                        setHosthubTokenName(tokenStatus.name ?? "");
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="ops-markers">
            <h2>Sync status</h2>
            {!latestHosthubPoll ? (
              <p className="ops-muted">No Hosthub sync runs yet.</p>
            ) : (
              <div className="ops-suggestion-card">
                <div className="ops-suggestion-score">
                  Latest Hosthub poll: {latestHosthubPoll.status ?? "unknown"}
                </div>
                <div className="ops-suggestion-reasons">
                  <div className="ops-suggestion-reason">Started: {fmtDateTime(latestHosthubPoll.startedAt)}</div>
                  <div className="ops-suggestion-reason">Completed: {fmtDateTime(latestHosthubPoll.completedAt)}</div>
                  <div className="ops-suggestion-reason">
                    Poll cursor: {latestHosthubPoll.cursor ? `${latestHosthubPoll.cursor.slice(0, 24)}…` : "none (full fetch next run)"}
                  </div>
                </div>
              </div>
            )}
            <div className="ops-drawer-row-actions">
              <button type="button" className="ops-btn ops-btn-primary" disabled={saving} onClick={() => void syncNow()}>
                Sync now
              </button>
              <button
                type="button"
                className="ops-btn ops-btn-primary"
                disabled={saving}
                title="Re-fetches calendar history from Hosthub without the incremental watermark (slower, more Hosthub API load than Sync now). Use if counts look behind Hosthub."
                onClick={() => void fullSyncNow()}
              >
                Full sync
              </button>
              <button type="button" className="ops-btn" disabled={saving} onClick={() => void previewSync()}>
                Preview sync (dry-run)
              </button>
              {isAdmin ? (
                <button
                  type="button"
                  className="ops-btn ops-btn-danger"
                  disabled={saving}
                  title="Clears the incremental sync watermark, then runs reconcile so Hosthub is queried from the beginning again."
                  onClick={() => void resetWatermarkAndSync()}
                >
                  Reset sync watermark and re-sync
                </button>
              ) : null}
            </div>
          </section>

          <section className="ops-markers">
            <h2>Hosthub diagnostics</h2>
            <p className="ops-muted">
              The listings table shows every row in <code>source_listings</code> (from synced reservations). Use this
              panel to compare DB counts with what Hosthub returns on the first API page (admin probe).
            </p>
            {diagError ? <p className="ops-error">{diagError}</p> : null}
            {diagLoading && !diagData ? <p className="ops-muted">Loading diagnostics…</p> : null}
            {diagData ? (
              <div className="ops-suggestion-card">
                <div className="ops-suggestion-score">
                  Listings in DB: <strong>{diagData.sourceListings.total}</strong>
                  {diagData.sourceListings.byChannel.length > 0 ? (
                    <span className="ops-muted">
                      {" "}
                      (
                      {diagData.sourceListings.byChannel.map((c) => `${c.channel}: ${c.count}`).join(", ")})
                    </span>
                  ) : null}
                </div>
                {diagData.syncRuns[0] ? (
                  <div className="ops-suggestion-reasons">
                    <div className="ops-suggestion-reason">
                      Latest poll (diag): {diagData.syncRuns[0]?.status ?? "unknown"} — started{" "}
                      {fmtDateTime(diagData.syncRuns[0]?.startedAt ?? null)}
                    </div>
                    <div className="ops-suggestion-reason">
                      Cursor:{" "}
                      {diagData.syncRuns[0]?.cursor
                        ? `${String(diagData.syncRuns[0].cursor).slice(0, 32)}…`
                        : "none"}
                    </div>
                    <div className="ops-suggestion-reason">Token: {diagData.tokenStatus.configured ? "configured" : "missing"}</div>
                  </div>
                ) : null}
                {diagData.importErrors.length > 0 ? (
                  <div className="ops-suggestion-reasons">
                    <div className="ops-suggestion-reason">
                      Recent import errors ({diagData.importErrors.length} shown):{" "}
                      {diagData.importErrors
                        .slice(0, 3)
                        .map((e) => `${e.code ?? "?"}: ${e.message}`)
                        .join(" · ")}
                    </div>
                  </div>
                ) : null}
                {diagData.probe ? (
                  <div className="ops-suggestion-reasons">
                    <div className="ops-suggestion-reason">
                      Probe: {diagData.probe.ok ? "ok" : "failed"} in {diagData.probe.durationMs}ms — first page rows{" "}
                      {diagData.probe.pageDataLength}, skipped {diagData.probe.pageSkipped}, next page{" "}
                      {diagData.probe.hasNextPage ? "yes" : "no"}, distinct listings on page{" "}
                      {diagData.probe.distinctListings.length}
                    </div>
                    {diagData.probe.error ? (
                      <div className="ops-suggestion-reason ops-error">
                        {diagData.probe.error.code}: {diagData.probe.error.message}
                      </div>
                    ) : (
                      <ul className="ops-muted" style={{ marginTop: "0.5rem", paddingLeft: "1.25rem" }}>
                        {diagData.probe.distinctListings.slice(0, 20).map((l) => (
                          <li key={`${l.channel}-${l.listingId}`}>
                            {l.channel} — {l.title ?? l.listingId} ({l.listingId})
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
                <div className="ops-drawer-row-actions" style={{ marginTop: "0.75rem" }}>
                  <button type="button" className="ops-btn" disabled={saving || diagLoading} onClick={() => void loadDiag({ probe: false })}>
                    Refresh diagnostics
                  </button>
                  {isAdmin ? (
                    <button type="button" className="ops-btn" disabled={saving || probeBusy || diagLoading} onClick={() => void loadDiag({ probe: true })}>
                      Run Hosthub probe (first page)
                    </button>
                  ) : (
                    <span className="ops-muted">Admin: run API probe to compare Hosthub vs DB.</span>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          <section className="ops-markers">
            <h2>Καταλύματα Hosthub</h2>
            <p className="ops-muted">
              Map each Hosthub listing to a tax rental slot (1–4). Changes apply to the Excel tax ledger after you
              reload that page.
            </p>
            <HosthubListingsSection />
          </section>
        </>
      )}
      <DryRunPreviewModal
        open={dryModalOpen}
        title="Hosthub sync — preview"
        summary={drySummary}
        busy={reconcileDryRun.state === "executing" || saving}
        executeLabel="Run sync now"
        onCancel={() => {
          if (reconcileDryRun.state === "executing" || saving) return;
          setDryModalOpen(false);
          setDrySummary(null);
        }}
        onConfirm={() => void confirmSyncAfterPreview()}
      />
    </main>
  );
}


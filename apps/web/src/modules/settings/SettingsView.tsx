"use client";

import { useEffect, useMemo, useState } from "react";
import { HosthubListingsSection } from "@/modules/settings/HosthubListingsSection";

type ApiError = { error?: { message?: string } };
type HosthubTokenStatus = { configured: boolean; updatedAt: string | null; name: string | null };

type SyncRunRow = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string | null;
  source: string | null;
  statsJson: unknown;
};

type SyncRunsResponse = { data?: { runs?: SyncRunRow[] } };

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
}

export function SettingsView() {
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

  const latestHosthubPoll = useMemo(() => runs.find((r) => r.source === "hosthub_poll") ?? null, [runs]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [tokenRes, runsRes] = await Promise.all([
        fetch("/api/admin/integrations/hosthub/token", { credentials: "include" }),
        fetch("/api/sync/runs", { credentials: "include" }),
      ]);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    function onTick() {
      void loadAll();
    }
    window.addEventListener("ops:hosthub-sync-tick", onTick);
    return () => window.removeEventListener("ops:hosthub-sync-tick", onTick);
  }, []);

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
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save token");
    } finally {
      setSaving(false);
    }
  }

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
        <h1>Settings</h1>
      </header>

      {loading && <p className="ops-muted">Loading settings…</p>}
      {error && <p className="ops-error">{error}</p>}
      {flash && (
        <div className="ops-toast" role="alert">
          {flash}
        </div>
      )}

      {!loading && (
        <>
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
                </div>
              </div>
            )}
            <button type="button" className="ops-btn ops-btn-primary" disabled={saving} onClick={() => void syncNow()}>
              Sync now
            </button>
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
    </main>
  );
}


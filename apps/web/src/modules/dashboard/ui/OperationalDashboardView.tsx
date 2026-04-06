"use client";

import { useEffect, useState } from "react";

type DashboardData = {
  sync: {
    totalRuns24h: number;
    successfulRuns24h: number;
    successRatio24h: number;
    latestRuns: Array<{ id: string; status: string; startedAt: string; completedAt: string | null }>;
  };
  importErrors: {
    unresolvedTotal: number;
    byCode: Array<{ code: string; count: number }>;
  };
  conflicts: {
    unresolvedTotal: number;
    byAgeBucket: { lt_24h: number; h24_to_72: number; gt_72h: number };
  };
  cleaning: {
    backlogByStatus: Array<{ status: string; count: number }>;
  };
};

export function OperationalDashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/dashboard/ops", { credentials: "include" });
        const json = (await res.json().catch(() => null)) as
          | { data?: DashboardData; error?: { message?: string } }
          | null;
        if (!res.ok) {
          throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
        }
        setData(json?.data ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <main className="ops-calendar-main">
      <h1>Operations dashboard</h1>
      {loading && <p className="ops-muted">Loading dashboard…</p>}
      {error && <p className="ops-error">{error}</p>}
      {!loading && !error && data && (
        <>
          <section className="ops-markers">
            <strong>Sync success (24h):</strong> {data.sync.successRatio24h}% ({data.sync.successfulRuns24h}/
            {data.sync.totalRuns24h})
          </section>
          <section className="ops-markers">
            <strong>Unresolved import errors:</strong> {data.importErrors.unresolvedTotal}
          </section>
          <section className="ops-markers">
            <strong>Unresolved conflicts:</strong> {data.conflicts.unresolvedTotal} (lt24h: {data.conflicts.byAgeBucket.lt_24h}
            , 24-72h: {data.conflicts.byAgeBucket.h24_to_72}, gt72h: {data.conflicts.byAgeBucket.gt_72h})
          </section>
          <section className="ops-markers">
            <strong>Cleaning backlog:</strong>{" "}
            {data.cleaning.backlogByStatus.map((r) => `${r.status}: ${r.count}`).join(", ")}
          </section>
        </>
      )}
    </main>
  );
}

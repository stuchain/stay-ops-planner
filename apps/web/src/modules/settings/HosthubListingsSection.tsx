"use client";

import { useCallback, useEffect, useState } from "react";

type HosthubListingRow = {
  id: string;
  channel: string;
  title: string | null;
  externalListingId: string;
  rentalIndex: number | null;
  bookingCount: number;
};

export function HosthubListingsSection() {
  const now = new Date();
  const maxYear = now.getUTCFullYear() + 1;
  const minYear = 2024;
  const [year, setYear] = useState(now.getUTCFullYear());
  const [listings, setListings] = useState<HosthubListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/excel/listings?year=${year}`, { credentials: "include" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error?.message ?? j?.message ?? "listings failed");
        setListings([]);
        return;
      }
      setListings((j.data?.listings as HosthubListingRow[] | undefined) ?? []);
    } catch {
      setError("Failed to load listings");
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  const patchListingRental = async (listingId: string, rentalIndex: number | null) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/excel/listings/${listingId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rentalIndex }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error?.message ?? j?.message ?? "PATCH listing failed");
        return;
      }
      const d = j.data as { rentalIndex?: number | null } | undefined;
      setListings((prev) =>
        prev.map((row) => (row.id === listingId ? { ...row, rentalIndex: d?.rentalIndex ?? null } : row)),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ops-excel-listings">
      <div className="ops-settings-listings-toolbar">
        <label className="ops-excel-year">
          Έτος για κρατήσεις{" "}
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={loading || saving}>
            {Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="ops-error">{error}</p> : null}
      {loading ? (
        <p className="ops-muted">Φόρτωση καταλυμάτων…</p>
      ) : (
        <table className="ops-excel-listings-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Τίτλος</th>
              <th>External id</th>
              <th>Κρατήσεις (έτος)</th>
              <th>TAX ROOM</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id}>
                <td>{l.channel}</td>
                <td>{l.title ?? "—"}</td>
                <td>{l.externalListingId}</td>
                <td>{l.bookingCount}</td>
                <td>
                  <select
                    value={l.rentalIndex == null ? "" : String(l.rentalIndex)}
                    disabled={saving}
                    onChange={(e) => {
                      const v = e.target.value;
                      void patchListingRental(l.id, v === "" ? null : Number(v));
                    }}
                  >
                    <option value="">—</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

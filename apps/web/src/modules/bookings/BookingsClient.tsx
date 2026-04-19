"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookingDetailModal } from "./BookingDetailModal";
import { ChannelLogo } from "./ChannelLogo";

type BookingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show"
  | "needs_reassignment";
type Channel = "airbnb" | "booking" | "direct";
type DateType = "checkinDate" | "checkoutDate" | "createdAt" | "updatedAt";

type BookingListItem = {
  id: string;
  channel: Channel;
  externalBookingId: string;
  status: BookingStatus;
  checkinDate: string;
  checkoutDate: string;
  nights: number;
  guestName: string;
  guestCount: number | null;
  totalValue: number | null;
  currency: string | null;
  action: string | null;
};

type Filters = {
  channel: "" | Channel;
  status: "" | BookingStatus;
  dateType: DateType;
  startDate: string;
  endDate: string;
  action: string;
  guestName: string;
  guestCountMin: string;
  guestCountMax: string;
  valueMin: string;
  valueMax: string;
};

const DEFAULT_FILTERS: Filters = {
  channel: "",
  status: "",
  dateType: "checkinDate",
  startDate: "",
  endDate: "",
  action: "",
  guestName: "",
  guestCountMin: "",
  guestCountMax: "",
  valueMin: "",
  valueMax: "",
};

function todayDateLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fmtMoney(value: number | null, currency: string | null): string {
  if (value === null) return "-";
  if (currency) return `${value.toFixed(2)} ${currency}`;
  return value.toFixed(2);
}

function toQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.status) params.set("status", filters.status);
  if (filters.startDate || filters.endDate) params.set("dateType", filters.dateType);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.action.trim()) params.set("action", filters.action.trim());
  if (filters.guestName.trim()) params.set("guestName", filters.guestName.trim());
  if (filters.guestCountMin.trim()) params.set("guestCountMin", filters.guestCountMin.trim());
  if (filters.guestCountMax.trim()) params.set("guestCountMax", filters.guestCountMax.trim());
  if (filters.valueMin.trim()) params.set("valueMin", filters.valueMin.trim());
  if (filters.valueMax.trim()) params.set("valueMax", filters.valueMax.trim());
  return params.toString();
}

export function BookingsClient() {
  const defaultFilters = useMemo<Filters>(() => ({ ...DEFAULT_FILTERS, startDate: todayDateLocal() }), []);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(false);
  const [items, setItems] = useState<BookingListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async (activeFilters: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const query = toQuery(activeFilters);
      const res = await fetch(`/api/bookings/list${query ? `?${query}` : ""}`, {
        method: "GET",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Failed to load bookings");
        setItems([]);
        return;
      }
      setItems(body.data.items as BookingListItem[]);
    } catch {
      setError("Failed to load bookings");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(defaultFilters);
  }, [defaultFilters, load]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const openBooking = useCallback((bookingId: string) => {
    setSelectedId(bookingId);
  }, []);

  const closeModal = useCallback(() => {
    setSelectedId(null);
  }, []);

  const totalText = useMemo(() => `${items.length} bookings`, [items.length]);

  return (
    <main className="ops-bookings-main">
      <header className="ops-bookings-header">
        <h1>Bookings</h1>
        <p className="ops-muted">Sorted by check-in date (earliest first)</p>
      </header>

      <section className="ops-bookings-filters" aria-label="Filters">
        <label className="ops-label">
          <span>Channel</span>
          <select
            className="ops-input"
            value={filters.channel}
            onChange={(e) => setFilters((s) => ({ ...s, channel: e.target.value as Filters["channel"] }))}
          >
            <option value="">All</option>
            <option value="airbnb">Airbnb</option>
            <option value="booking">Booking</option>
            <option value="direct">Direct</option>
          </select>
        </label>
        <label className="ops-label">
          <span>Status</span>
          <select
            className="ops-input"
            value={filters.status}
            onChange={(e) => setFilters((s) => ({ ...s, status: e.target.value as Filters["status"] }))}
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
            <option value="no_show">No show</option>
            <option value="needs_reassignment">Needs reassignment</option>
          </select>
        </label>
        <label className="ops-label">
          <span>Guest name</span>
          <input
            className="ops-input"
            type="text"
            value={filters.guestName}
            onChange={(e) => setFilters((s) => ({ ...s, guestName: e.target.value }))}
            placeholder="Search guest"
          />
        </label>
        <label className="ops-label">
          <span>Date type</span>
          <select
            className="ops-input"
            value={filters.dateType}
            onChange={(e) => setFilters((s) => ({ ...s, dateType: e.target.value as DateType }))}
          >
            <option value="checkinDate">Check-in date</option>
            <option value="checkoutDate">Checkout date</option>
            <option value="createdAt">Created date</option>
            <option value="updatedAt">Updated date</option>
          </select>
        </label>
        <label className="ops-label">
          <span>Start date</span>
          <input
            className="ops-input"
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters((s) => ({ ...s, startDate: e.target.value }))}
          />
        </label>
        <label className="ops-label">
          <span>End date</span>
          <input
            className="ops-input"
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters((s) => ({ ...s, endDate: e.target.value }))}
          />
        </label>
        <div className="ops-bookings-advanced-toggle-wrap">
          <button
            className="ops-btn"
            type="button"
            onClick={() => setShowAdvancedFilters((v) => !v)}
            aria-expanded={showAdvancedFilters}
          >
            {showAdvancedFilters ? "Hide advanced filters" : "More filters"}
          </button>
        </div>
        {showAdvancedFilters ? (
          <>
            <label className="ops-label">
              <span>Action</span>
              <input
                className="ops-input"
                type="text"
                value={filters.action}
                onChange={(e) => setFilters((s) => ({ ...s, action: e.target.value }))}
                placeholder="Any action"
              />
            </label>
            <label className="ops-label">
              <span>Guests min</span>
              <input
                className="ops-input"
                type="number"
                min={0}
                value={filters.guestCountMin}
                onChange={(e) => setFilters((s) => ({ ...s, guestCountMin: e.target.value }))}
              />
            </label>
            <label className="ops-label">
              <span>Guests max</span>
              <input
                className="ops-input"
                type="number"
                min={0}
                value={filters.guestCountMax}
                onChange={(e) => setFilters((s) => ({ ...s, guestCountMax: e.target.value }))}
              />
            </label>
            <label className="ops-label">
              <span>Value min</span>
              <input
                className="ops-input"
                type="number"
                min={0}
                step="0.01"
                value={filters.valueMin}
                onChange={(e) => setFilters((s) => ({ ...s, valueMin: e.target.value }))}
              />
            </label>
            <label className="ops-label">
              <span>Value max</span>
              <input
                className="ops-input"
                type="number"
                min={0}
                step="0.01"
                value={filters.valueMax}
                onChange={(e) => setFilters((s) => ({ ...s, valueMax: e.target.value }))}
              />
            </label>
          </>
        ) : null}
        <div className="ops-bookings-filter-actions">
          <button className="ops-btn ops-btn-primary" type="button" onClick={() => void load(filters)}>
            Search
          </button>
          <button
            className="ops-btn"
            type="button"
            onClick={() => {
              const cleared = { ...defaultFilters };
              setFilters(cleared);
              void load(cleared);
              setShowAdvancedFilters(false);
            }}
          >
            Clear
          </button>
        </div>
      </section>

      <section className="ops-bookings-list-wrap" aria-label="Bookings list">
        <div className="ops-bookings-list-head">
          <strong>{totalText}</strong>
        </div>
        {loading ? <p className="ops-muted">Loading bookings...</p> : null}
        {error ? <p className="ops-error">{error}</p> : null}
        {!loading && !error && items.length === 0 ? <p className="ops-muted">No bookings found.</p> : null}
        {!loading && !error && items.length > 0 ? (
          <table className="ops-bookings-table">
            <thead>
              <tr>
                <th>Guest</th>
                <th>Check-in</th>
                <th>Checkout</th>
                <th>Total value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button className="ops-bookings-row-btn" type="button" onClick={() => openBooking(item.id)}>
                      <span className="ops-name-with-logo">
                        <ChannelLogo channel={item.channel} className="ops-channel-logo" />
                        <span>{item.guestName}</span>
                      </span>
                    </button>
                  </td>
                  <td>{item.checkinDate}</td>
                  <td>{item.checkoutDate}</td>
                  <td>{fmtMoney(item.totalValue, item.currency)}</td>
                  <td>{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <BookingDetailModal bookingId={selectedId} onClose={closeModal} onAfterSave={() => void load(filters)} />

      {toast ? <div className="ops-toast">{toast}</div> : null}
    </main>
  );
}

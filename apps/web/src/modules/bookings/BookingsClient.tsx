"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { DryRunResult } from "@stay-ops/shared";
import { useI18n } from "@/i18n/I18nProvider";
import { DryRunPreviewModal, useDryRun } from "@/modules/dry-run";
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
type ReservationStatus = "all" | "active" | "cancelled";
type SortBy = "updatedAt" | "createdAt" | "checkinDate" | "checkoutDate" | "totalValue";
type SortOrder = "asc" | "desc";
type ExportMenu = "standard" | "financial" | null;
type MultiSelectMenu = "rentals" | "channels" | null;

type BulkCancelBody = { bookingIds: string[] };

type BookingListItem = {
  id: string;
  channel: Channel;
  externalBookingId: string;
  status: BookingStatus;
  checkinDate: string;
  checkoutDate: string;
  createdAt: string;
  updatedAt: string;
  nights: number;
  guestName: string;
  guestCount: number | null;
  totalValue: number | null;
  currency: string | null;
  cleaningFee: number | null;
  taxes: number | null;
  payout: number | null;
  guestPaid: number | null;
  action: string | null;
  assignedRentalId: string | null;
  assignedRentalName: string | null;
};

type Filters = {
  search: string;
  channels: Channel[];
  rentalIds: string[];
  reservationStatus: ReservationStatus;
  startDate: string;
  endDate: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
};

const DEFAULT_FILTERS: Filters = {
  search: "",
  channels: [],
  rentalIds: [],
  reservationStatus: "all",
  startDate: "",
  endDate: "",
  sortBy: "checkinDate",
  sortOrder: "asc",
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
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  }
  return value.toFixed(2);
}

function fmtDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = `${date.getDate()}`.padStart(2, "0");
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function toQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  for (const channel of filters.channels) params.append("channels", channel);
  for (const rentalId of filters.rentalIds) params.append("rentalIds", rentalId);
  params.set("reservationStatus", filters.reservationStatus);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  params.set("sortBy", filters.sortBy);
  params.set("sortOrder", filters.sortOrder);
  return params.toString();
}

export function BookingsClient() {
  const { t } = useI18n();
  const bulkCancelDry = useDryRun<BulkCancelBody>({
    url: "/api/bookings/bulk-cancel",
    buildBody: (input) => ({ bookingIds: input.bookingIds }),
  });
  const [selectedCancelIds, setSelectedCancelIds] = useState<string[]>([]);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<DryRunResult | null>(null);
  const [bulkCancelIds, setBulkCancelIds] = useState<string[] | null>(null);
  const [pendingBulkCancel, setPendingBulkCancel] = useState(false);

  const defaultFilters = useMemo<Filters>(() => ({ ...DEFAULT_FILTERS, startDate: todayDateLocal() }), []);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [items, setItems] = useState<BookingListItem[]>([]);
  const [rentalOptions, setRentalOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [exportMenu, setExportMenu] = useState<ExportMenu>(null);
  const [multiSelectMenu, setMultiSelectMenu] = useState<MultiSelectMenu>(null);
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const firstLiveRunRef = useRef<boolean>(true);
  const multiSelectWrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (activeFilters: Filters, options?: { keepExportMenu?: boolean }) => {
    setLoading(true);
    setError(null);
    if (!options?.keepExportMenu) setExportMenu(null);
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
      const nextItems = body.data.items as BookingListItem[];
      setItems(nextItems);
      setRentalOptions((prev) => {
        const map = new Map(prev.map((item) => [item.id, item.name]));
        for (const row of nextItems) {
          if (!row.assignedRentalId || !row.assignedRentalName) continue;
          map.set(row.assignedRentalId, row.assignedRentalName);
        }
        return [...map.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name));
      });
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
    if (firstLiveRunRef.current) {
      firstLiveRunRef.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      void load(filters);
    }, 320);
    return () => window.clearTimeout(id);
  }, [filters, load]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!multiSelectWrapRef.current || !filtersOpen) return;
      if (!multiSelectWrapRef.current.contains(event.target as Node)) {
        setMultiSelectMenu(null);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [filtersOpen]);

  const selectableItems = useMemo(
    () => items.filter((item) => item.status !== "cancelled"),
    [items],
  );

  const toggleCancelSelect = useCallback((bookingId: string) => {
    setSelectedCancelIds((prev) =>
      prev.includes(bookingId) ? prev.filter((id) => id !== bookingId) : [...prev, bookingId],
    );
  }, []);

  const selectAllCancellable = useCallback(() => {
    const all = selectableItems.map((i) => i.id);
    if (all.length === selectedCancelIds.length && all.every((id) => selectedCancelIds.includes(id))) {
      setSelectedCancelIds([]);
    } else {
      setSelectedCancelIds(all);
    }
  }, [selectableItems, selectedCancelIds]);

  const bulkPreviewCancel = useCallback(async () => {
    if (selectedCancelIds.length === 0) return;
    setPendingBulkCancel(true);
    setError(null);
    try {
      const summary = await bulkCancelDry.preview({ bookingIds: selectedCancelIds });
      setBulkCancelIds([...selectedCancelIds]);
      setBulkSummary(summary);
      setBulkModalOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk cancel preview failed");
    } finally {
      setPendingBulkCancel(false);
    }
  }, [bulkCancelDry, selectedCancelIds]);

  const bulkExecuteCancel = useCallback(async () => {
    if (!bulkCancelIds?.length) return;
    setPendingBulkCancel(true);
    setError(null);
    try {
      await bulkCancelDry.execute({ bookingIds: bulkCancelIds });
      setBulkModalOpen(false);
      setBulkSummary(null);
      setBulkCancelIds(null);
      setSelectedCancelIds([]);
      await load(filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk cancel failed");
    } finally {
      setPendingBulkCancel(false);
    }
  }, [bulkCancelDry, bulkCancelIds, filters, load]);

  const openBooking = useCallback((bookingId: string) => {
    setSelectedId(bookingId);
  }, []);

  const closeModal = useCallback(() => {
    setSelectedId(null);
  }, []);

  const onRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableRowElement>, bookingId: string) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openBooking(bookingId);
    },
    [openBooking],
  );

  const toggleChannel = useCallback((channel: Channel) => {
    setFilters((state) => {
      const has = state.channels.includes(channel);
      return {
        ...state,
        channels: has ? state.channels.filter((value) => value !== channel) : [...state.channels, channel],
      };
    });
  }, []);

  const toggleRental = useCallback((rentalId: string) => {
    setFilters((state) => {
      const has = state.rentalIds.includes(rentalId);
      return {
        ...state,
        rentalIds: has ? state.rentalIds.filter((value) => value !== rentalId) : [...state.rentalIds, rentalId],
      };
    });
  }, []);

  const selectedRentalLabels = useMemo(() => {
    const map = new Map(rentalOptions.map((rental) => [rental.id, rental.name]));
    return filters.rentalIds.map((id) => map.get(id) ?? id);
  }, [filters.rentalIds, rentalOptions]);

  const selectedChannelLabels = useMemo(
    () =>
      filters.channels.map((channel) => (channel === "airbnb" ? "Airbnb" : channel === "booking" ? "Booking" : "Direct")),
    [filters.channels],
  );

  const setSort = useCallback((sortBy: SortBy, sortOrder: SortOrder) => {
    setFilters((state) => ({ ...state, sortBy, sortOrder }));
  }, []);

  const cycleHeaderSort = useCallback(
    (sortBy: SortBy) => {
      if (filters.sortBy !== sortBy) {
        setSort(sortBy, "asc");
        return;
      }
      if (filters.sortOrder === "asc") {
        setSort(sortBy, "desc");
        return;
      }
      setSort(defaultFilters.sortBy, defaultFilters.sortOrder);
    },
    [defaultFilters.sortBy, defaultFilters.sortOrder, filters.sortBy, filters.sortOrder, setSort],
  );

  const sortLabel = useCallback(
    (sortBy: SortBy) => {
      if (filters.sortBy !== sortBy) return "";
      return filters.sortOrder === "asc" ? " ▲" : " ▼";
    },
    [filters.sortBy, filters.sortOrder],
  );

  const toCsv = useCallback((rows: BookingListItem[], kind: ExportMenu): string => {
    const isFinancial = kind === "financial";
    const headers = isFinancial
      ? [
          "Booking ID",
          "Guest",
          "Rental",
          "Channel",
          "Total Value",
          "Currency",
          "Cleaning Fee",
          "Taxes",
          "Payout",
          "Guest Paid",
        ]
      : [
          "Booking ID",
          "Guest",
          "Rental",
          "Channel",
          "Status",
          "Check-in",
          "Check-out",
          "Date Created",
          "Date Updated",
          "Guests",
          "Total Value",
          "Currency",
        ];
    const rowValues = rows.map((row) =>
      isFinancial
        ? [
            row.externalBookingId,
            row.guestName,
            row.assignedRentalName ?? "Unassigned",
            row.channel,
            row.totalValue ?? "",
            row.currency ?? "",
            row.cleaningFee ?? "",
            row.taxes ?? "",
            row.payout ?? "",
            row.guestPaid ?? "",
          ]
        : [
            row.externalBookingId,
            row.guestName,
            row.assignedRentalName ?? "Unassigned",
            row.channel,
            row.status,
            row.checkinDate,
            row.checkoutDate,
            row.createdAt,
            row.updatedAt,
            row.guestCount ?? "",
            row.totalValue ?? "",
            row.currency ?? "",
          ],
    );
    return [headers, ...rowValues]
      .map((line) =>
        line
          .map((cell) => {
            const text = String(cell ?? "");
            const escaped = text.replaceAll('"', '""');
            return `"${escaped}"`;
          })
          .join(","),
      )
      .join("\n");
  }, []);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }, []);

  const exportRows = useCallback(
    async (kind: ExportMenu, format: "csv" | "xlsx") => {
      if (!kind) return;
      if (format === "csv") {
        const csv = toCsv(items, kind);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        downloadBlob(blob, `${kind === "financial" ? "bookings-financial" : "bookings"}-${todayDateLocal()}.csv`);
        setExportMenu(null);
        return;
      }

      const xlsx = await import("xlsx");
      const records =
        kind === "financial"
          ? items.map((row) => ({
              bookingId: row.externalBookingId,
              guest: row.guestName,
              rental: row.assignedRentalName ?? "Unassigned",
              channel: row.channel,
              totalValue: row.totalValue,
              currency: row.currency,
              cleaningFee: row.cleaningFee,
              taxes: row.taxes,
              payout: row.payout,
              guestPaid: row.guestPaid,
            }))
          : items.map((row) => ({
              bookingId: row.externalBookingId,
              guest: row.guestName,
              rental: row.assignedRentalName ?? "Unassigned",
              channel: row.channel,
              status: row.status,
              checkin: row.checkinDate,
              checkout: row.checkoutDate,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              guests: row.guestCount,
              totalValue: row.totalValue,
              currency: row.currency,
            }));
      const worksheet = xlsx.utils.json_to_sheet(records);
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, "Bookings");
      const out = xlsx.write(workbook, { type: "array", bookType: "xlsx" });
      const blob = new Blob([out], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      downloadBlob(blob, `${kind === "financial" ? "bookings-financial" : "bookings"}-${todayDateLocal()}.xlsx`);
      setExportMenu(null);
    },
    [downloadBlob, items, toCsv],
  );

  const totalText = useMemo(() => `${items.length} bookings`, [items.length]);
  const sortLabelText = useMemo(() => {
    const nameMap: Record<SortBy, string> = {
      updatedAt: "date updated",
      createdAt: "date created",
      checkinDate: "check-in date",
      checkoutDate: "check-out date",
      totalValue: "total value",
    };
    return `Sorted by ${nameMap[filters.sortBy]} (${filters.sortOrder})`;
  }, [filters.sortBy, filters.sortOrder]);

  return (
    <main className="ops-bookings-main">
      <header className="ops-bookings-header">
        <h1>{t("bookings.title")}</h1>
        <p className="ops-muted">{sortLabelText}</p>
      </header>

      <section className="ops-bookings-filters" aria-label="Filters" ref={multiSelectWrapRef}>
        <div className="ops-bookings-toolbar-row">
          <label className="ops-label ops-bookings-searchbar">
            <span>Search bookings</span>
            <input
              className="ops-input"
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((state) => ({ ...state, search: e.target.value }))}
              placeholder="Guest name or booking ID"
            />
          </label>
          <button
            className="ops-btn"
            type="button"
            onClick={() => {
              setFiltersOpen((state) => !state);
              setMultiSelectMenu(null);
            }}
            aria-expanded={filtersOpen}
          >
            Filters
          </button>
          <button
            className="ops-btn"
            type="button"
            onClick={() => setExportMenu((state) => (state === "standard" ? null : "standard"))}
          >
            Export
          </button>
          <button
            className="ops-btn"
            type="button"
            onClick={() => setExportMenu((state) => (state === "financial" ? null : "financial"))}
          >
            Financial export
          </button>
          {exportMenu ? (
            <span className="ops-bookings-export-picker">
              <button className="ops-btn" type="button" onClick={() => void exportRows(exportMenu, "csv")}>
                CSV
              </button>
              <button className="ops-btn" type="button" onClick={() => void exportRows(exportMenu, "xlsx")}>
                XLSX
              </button>
            </span>
          ) : null}
        </div>
        {filtersOpen ? (
          <div className="ops-bookings-filters-panel">
        <div className="ops-label">
          <span>Rentals</span>
          <div className="ops-multiselect">
            <button
              className="ops-multiselect-trigger"
              type="button"
              onClick={() => setMultiSelectMenu((state) => (state === "rentals" ? null : "rentals"))}
            >
              {selectedRentalLabels.length === 0 ? (
                <span className="ops-muted">All rentals</span>
              ) : (
                <span className="ops-multiselect-chips">
                  {selectedRentalLabels.map((label) => (
                    <span key={label} className="ops-multiselect-chip">
                      {label}
                    </span>
                  ))}
                </span>
              )}
            </button>
            {multiSelectMenu === "rentals" ? (
              <div className="ops-multiselect-menu">
                <button
                  className="ops-multiselect-clear"
                  type="button"
                  onClick={() => setFilters((state) => ({ ...state, rentalIds: [] }))}
                >
                  Clear selection
                </button>
                {rentalOptions.length === 0 ? (
                  <p className="ops-muted">No rentals available yet.</p>
                ) : (
                  rentalOptions.map((rental) => (
                    <label key={rental.id} className="ops-multiselect-option">
                      <input
                        type="checkbox"
                        checked={filters.rentalIds.includes(rental.id)}
                        onChange={() => toggleRental(rental.id)}
                      />
                      <span>{rental.name}</span>
                    </label>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>
        <div className="ops-label">
          <span>Channels</span>
          <div className="ops-multiselect">
            <button
              className="ops-multiselect-trigger"
              type="button"
              onClick={() => setMultiSelectMenu((state) => (state === "channels" ? null : "channels"))}
            >
              {selectedChannelLabels.length === 0 ? (
                <span className="ops-muted">All channels</span>
              ) : (
                <span className="ops-multiselect-chips">
                  {selectedChannelLabels.map((label) => (
                    <span key={label} className="ops-multiselect-chip">
                      {label}
                    </span>
                  ))}
                </span>
              )}
            </button>
            {multiSelectMenu === "channels" ? (
              <div className="ops-multiselect-menu">
                <button
                  className="ops-multiselect-clear"
                  type="button"
                  onClick={() => setFilters((state) => ({ ...state, channels: [] }))}
                >
                  Clear selection
                </button>
                <label className="ops-multiselect-option">
                  <input
                    type="checkbox"
                    checked={filters.channels.includes("airbnb")}
                    onChange={() => toggleChannel("airbnb")}
                  />
                  <span>Airbnb</span>
                </label>
                <label className="ops-multiselect-option">
                  <input
                    type="checkbox"
                    checked={filters.channels.includes("booking")}
                    onChange={() => toggleChannel("booking")}
                  />
                  <span>Booking</span>
                </label>
                <label className="ops-multiselect-option">
                  <input
                    type="checkbox"
                    checked={filters.channels.includes("direct")}
                    onChange={() => toggleChannel("direct")}
                  />
                  <span>Direct</span>
                </label>
              </div>
            ) : null}
          </div>
        </div>
        <label className="ops-label">
          <span>Status</span>
          <select
            className="ops-input"
            value={filters.reservationStatus}
            onChange={(e) =>
              setFilters((state) => ({
                ...state,
                reservationStatus: e.target.value as ReservationStatus,
              }))
            }
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="ops-label">
          <span>Date range (check-in)</span>
          <div className="ops-bookings-date-range">
            <input
              className="ops-input"
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters((state) => ({ ...state, startDate: e.target.value }))}
            />
            <input
              className="ops-input"
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters((state) => ({ ...state, endDate: e.target.value }))}
            />
          </div>
        </label>
        <label className="ops-label">
          <span>Sort by</span>
          <select
            className="ops-input"
            value={filters.sortBy}
            onChange={(e) => setSort(e.target.value as SortBy, filters.sortOrder)}
          >
            <option value="updatedAt">Date updated</option>
            <option value="createdAt">Date created</option>
            <option value="checkinDate">Check-in date</option>
            <option value="checkoutDate">Check-out date</option>
            <option value="totalValue">Total value</option>
          </select>
        </label>
        <label className="ops-label">
          <span>Sort order</span>
          <select
            className="ops-input"
            value={filters.sortOrder}
            onChange={(e) => setSort(filters.sortBy, e.target.value as SortOrder)}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
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
              setMultiSelectMenu(null);
              void load(cleared);
            }}
          >
            Clear filters
          </button>
        </div>
          </div>
        ) : null}
      </section>

      <section className="ops-bookings-list-wrap" aria-label="Bookings list">
        <div className="ops-bookings-list-head">
          <strong>{totalText}</strong>
          {selectedCancelIds.length > 0 ? (
            <div className="ops-drawer-row-actions" style={{ marginTop: "0.5rem" }}>
              <button
                type="button"
                className="ops-btn ops-btn-danger"
                disabled={pendingBulkCancel}
                onClick={() => void bulkPreviewCancel()}
              >
                {pendingBulkCancel ? "Previewing…" : `Bulk cancel with preview (${selectedCancelIds.length})`}
              </button>
              <button type="button" className="ops-btn" disabled={pendingBulkCancel} onClick={() => setSelectedCancelIds([])}>
                Clear selection
              </button>
            </div>
          ) : null}
        </div>
        {loading ? <p className="ops-muted">Loading bookings...</p> : null}
        {error ? <p className="ops-error">{error}</p> : null}
        {!loading && !error && items.length === 0 ? <p className="ops-muted">No bookings found.</p> : null}
        {!loading && !error && items.length > 0 ? (
          <table className="ops-bookings-table">
            <thead>
              <tr>
                <th className="ops-bookings-th-static" aria-label="Select for bulk cancel">
                  {selectableItems.length > 0 ? (
                    <input
                      type="checkbox"
                      checked={
                        selectableItems.length > 0 &&
                        selectableItems.every((i) => selectedCancelIds.includes(i.id))
                      }
                      onChange={() => selectAllCancellable()}
                      title="Select all cancellable bookings"
                    />
                  ) : null}
                </th>
                <th className="ops-bookings-th-static">Booking</th>
                <th className="ops-bookings-th-static">Rental</th>
                <th className="ops-bookings-th-static">Guest name</th>
                <th>
                  <button className="ops-bookings-sort-btn" type="button" onClick={() => cycleHeaderSort("checkinDate")}>
                    Check-in{sortLabel("checkinDate")}
                  </button>
                </th>
                <th>
                  <button className="ops-bookings-sort-btn" type="button" onClick={() => cycleHeaderSort("checkoutDate")}>
                    Check-out{sortLabel("checkoutDate")}
                  </button>
                </th>
                <th>
                  <button className="ops-bookings-sort-btn" type="button" onClick={() => cycleHeaderSort("totalValue")}>
                    Total value{sortLabel("totalValue")}
                  </button>
                </th>
                <th className="ops-bookings-th-static">Guests</th>
                <th>
                  <button className="ops-bookings-sort-btn" type="button" onClick={() => cycleHeaderSort("createdAt")}>
                    Date created{sortLabel("createdAt")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="ops-bookings-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => openBooking(item.id)}
                  onKeyDown={(event) => onRowKeyDown(event, item.id)}
                  aria-label={`Open booking ${item.externalBookingId}`}
                >
                  <td
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    {item.status !== "cancelled" ? (
                      <input
                        type="checkbox"
                        checked={selectedCancelIds.includes(item.id)}
                        onChange={() => toggleCancelSelect(item.id)}
                        aria-label={`Select ${item.externalBookingId} for bulk cancel`}
                      />
                    ) : null}
                  </td>
                  <td>
                    <span className="ops-bookings-row-logo">
                      <ChannelLogo channel={item.channel} className="ops-channel-logo" />
                    </span>
                  </td>
                  <td>{item.assignedRentalName ?? "Unassigned ⚠"}</td>
                  <td>{item.guestName}</td>
                  <td>{fmtDate(item.checkinDate)}</td>
                  <td>{fmtDate(item.checkoutDate)}</td>
                  <td>{fmtMoney(item.totalValue, item.currency)}</td>
                  <td>{item.guestCount ?? "-"}</td>
                  <td>{fmtDate(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <BookingDetailModal bookingId={selectedId} onClose={closeModal} onAfterSave={() => void load(filters)} />
      <DryRunPreviewModal
        open={bulkModalOpen}
        title="Bulk cancel bookings — preview"
        summary={bulkSummary}
        busy={bulkCancelDry.state === "executing" || pendingBulkCancel}
        executeLabel="Confirm bulk cancel"
        onCancel={() => {
          if (bulkCancelDry.state === "executing" || pendingBulkCancel) return;
          setBulkModalOpen(false);
          setBulkSummary(null);
          setBulkCancelIds(null);
        }}
        onConfirm={() => void bulkExecuteCancel()}
      />
    </main>
  );
}

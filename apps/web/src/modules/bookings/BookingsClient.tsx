"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type BookingDetail = BookingListItem & {
  createdAt: string;
  updatedAt: string;
  sourceListingId: string | null;
  sourceListingName: string | null;
  assignment: {
    id: string;
    roomId: string;
    startDate: string;
    endDate: string;
    version: number;
  } | null;
  contact: {
    email: string | null;
    phone: string | null;
  };
  guests: {
    adults: number | null;
    children: number | null;
    infants: number | null;
    total: number | null;
  };
  money: {
    total: number | null;
    currency: string | null;
    cleaningFee: number | null;
    taxes: number | null;
    payout: number | null;
    guestPaid: number | null;
  };
  notes: string | null;
  hosthub: {
    calendarEventRaw: unknown;
    notesRaw: unknown;
    grTaxesRaw: unknown;
  };
  notesTimeline: Array<{
    id: string | null;
    created: string | null;
    updated: string | null;
    status: string | null;
    content: string | null;
  }>;
  payloadSections: Array<{
    id: string;
    title: string;
    fields: Array<{
      key: string;
      label: string;
      value: string;
    }>;
  }>;
  rawPayload: unknown;
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

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
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
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<"" | BookingStatus>("");
  const [editGuestName, setEditGuestName] = useState<string>("");
  const [editEmail, setEditEmail] = useState<string>("");
  const [editPhone, setEditPhone] = useState<string>("");
  const [editAdults, setEditAdults] = useState<string>("");
  const [editChildren, setEditChildren] = useState<string>("");
  const [editInfants, setEditInfants] = useState<string>("");
  const [editTotalGuests, setEditTotalGuests] = useState<string>("");
  const [editTotalValue, setEditTotalValue] = useState<string>("");
  const [editCurrency, setEditCurrency] = useState<string>("");
  const [editNotes, setEditNotes] = useState<string>("");
  const [editAction, setEditAction] = useState<string>("");

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

  const openBooking = useCallback(async (bookingId: string) => {
    setSelectedId(bookingId);
    setDetailLoading(true);
    setEditing(false);
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "GET",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) {
        setToast(body?.error?.message ?? "Could not open booking");
        setDetail(null);
        return;
      }
      const booking = body.data as BookingDetail;
      setDetail(booking);
      setEditStatus(booking.status);
      setEditGuestName(booking.guestName ?? "");
      setEditEmail(booking.contact.email ?? "");
      setEditPhone(booking.contact.phone ?? "");
      setEditAdults(booking.guests.adults !== null ? String(booking.guests.adults) : "");
      setEditChildren(booking.guests.children !== null ? String(booking.guests.children) : "");
      setEditInfants(booking.guests.infants !== null ? String(booking.guests.infants) : "");
      setEditTotalGuests(booking.guests.total !== null ? String(booking.guests.total) : "");
      setEditTotalValue(booking.money.total !== null ? String(booking.money.total) : "");
      setEditCurrency(booking.money.currency ?? "");
      setEditNotes(booking.notes ?? "");
      setEditAction(booking.action ?? "");
    } catch {
      setToast("Could not open booking");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeModal = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
    setEditing(false);
  }, []);

  const onCopy = useCallback(async () => {
    if (!detail) return;
    const text = [
      `Booking ID: ${detail.id}`,
      `Guest: ${detail.guestName}`,
      `Email: ${detail.contact.email ?? "-"}`,
      `Phone: ${detail.contact.phone ?? "-"}`,
      `Check-in: ${detail.checkinDate}`,
      `Check-out: ${detail.checkoutDate}`,
      `Guests: ${detail.guests.total ?? detail.guestCount ?? "-"}`,
      `Value: ${fmtMoney(detail.money.total, detail.money.currency)}`,
      `Status: ${detail.status}`,
      `Channel: ${detail.channel}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setToast("Booking details copied");
  }, [detail]);

  const onSendMessage = useCallback(() => {
    if (!detail) return;
    const email = detail.contact.email;
    if (!email) {
      setToast("No email available for this booking");
      return;
    }
    const subject = encodeURIComponent(`Booking ${detail.externalBookingId}`);
    const body = encodeURIComponent(
      `Hello ${detail.guestName},\n\nRegarding your stay from ${detail.checkinDate} to ${detail.checkoutDate}.`,
    );
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  }, [detail]);

  const onSave = useCallback(async () => {
    if (!selectedId || !detail) return;
    setSaving(true);
    try {
      const payload = {
        status: editStatus || undefined,
        editable: {
          guestName: editGuestName || undefined,
          email: editEmail || undefined,
          phone: editPhone || undefined,
          adults: editAdults !== "" ? Number(editAdults) : undefined,
          children: editChildren !== "" ? Number(editChildren) : undefined,
          infants: editInfants !== "" ? Number(editInfants) : undefined,
          totalGuests: editTotalGuests !== "" ? Number(editTotalGuests) : undefined,
          totalValue: editTotalValue !== "" ? Number(editTotalValue) : undefined,
          currency: editCurrency || undefined,
          notes: editNotes || undefined,
          action: editAction || undefined,
        },
      };
      const res = await fetch(`/api/bookings/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setToast(body?.error?.message ?? "Failed to save booking");
        return;
      }
      const updated = body.data.booking as BookingDetail;
      setDetail(updated);
      setEditing(false);
      setToast("Booking saved locally (Hosthub unchanged)");
      await load(filters);
    } catch {
      setToast("Failed to save booking");
    } finally {
      setSaving(false);
    }
  }, [
    detail,
    editAction,
    editAdults,
    editChildren,
    editCurrency,
    editEmail,
    editGuestName,
    editInfants,
    editNotes,
    editPhone,
    editStatus,
    editTotalGuests,
    editTotalValue,
    filters,
    load,
    selectedId,
  ]);

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
                    <button className="ops-bookings-row-btn" type="button" onClick={() => void openBooking(item.id)}>
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

      {selectedId ? (
        <div
          className="ops-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Booking details"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="ops-modal ops-booking-modal">
            {detailLoading || !detail ? (
              <p className="ops-muted">Loading booking details...</p>
            ) : (
              <>
                <div className="ops-booking-modal-head">
                  <h2 className="ops-name-with-logo">
                    <ChannelLogo channel={detail.channel} className="ops-channel-logo" />
                    <span>{detail.guestName}</span>
                  </h2>
                  <div className="ops-booking-modal-head-actions">
                    <button className="ops-btn" type="button" onClick={onCopy}>
                      Copy details
                    </button>
                    <button className="ops-btn" type="button" onClick={onSendMessage}>
                      Send message
                    </button>
                    <button className="ops-btn" type="button" onClick={() => setEditing((v) => !v)}>
                      {editing ? "Cancel edit" : "Edit"}
                    </button>
                  </div>
                </div>

                <section className="ops-booking-modal-section">
                  <h3>Stay</h3>
                  <p>
                    <strong>Booking ID:</strong> {detail.id}
                  </p>
                  <p>
                    <strong>External ID:</strong> {detail.externalBookingId}
                  </p>
                  <p>
                    <strong>Check-in:</strong> {detail.checkinDate} | <strong>Checkout:</strong> {detail.checkoutDate}
                  </p>
                  <p>
                    <strong>Nights:</strong> {detail.nights} | <strong>Status:</strong>{" "}
                    {editing ? (
                      <select
                        className="ops-input ops-inline-edit"
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value as BookingStatus)}
                      >
                        <option value="pending">pending</option>
                        <option value="confirmed">confirmed</option>
                        <option value="cancelled">cancelled</option>
                        <option value="completed">completed</option>
                        <option value="no_show">no_show</option>
                        <option value="needs_reassignment">needs_reassignment</option>
                      </select>
                    ) : (
                      detail.status
                    )}
                  </p>
                  <p>
                    <strong>Channel:</strong> {detail.channel}
                  </p>
                </section>

                <section className="ops-booking-modal-section">
                  <h3>Contact</h3>
                  <label className="ops-label">
                    <span>Name</span>
                    <input
                      className="ops-input"
                      value={editing ? editGuestName : detail.guestName}
                      disabled={!editing}
                      onChange={(e) => setEditGuestName(e.target.value)}
                    />
                  </label>
                  <label className="ops-label">
                    <span>Email</span>
                    <input
                      className="ops-input"
                      value={editing ? editEmail : detail.contact.email ?? ""}
                      disabled={!editing}
                      onChange={(e) => setEditEmail(e.target.value)}
                    />
                  </label>
                  <label className="ops-label">
                    <span>Phone</span>
                    <input
                      className="ops-input"
                      value={editing ? editPhone : detail.contact.phone ?? ""}
                      disabled={!editing}
                      onChange={(e) => setEditPhone(e.target.value)}
                    />
                  </label>
                </section>

                <section className="ops-booking-modal-section">
                  <h3>Guests</h3>
                  <div className="ops-booking-grid-2">
                    <label className="ops-label">
                      <span>Adults</span>
                      <input
                        className="ops-input"
                        type="number"
                        min={0}
                        value={editing ? editAdults : detail.guests.adults ?? ""}
                        disabled={!editing}
                        onChange={(e) => setEditAdults(e.target.value)}
                      />
                    </label>
                    <label className="ops-label">
                      <span>Children</span>
                      <input
                        className="ops-input"
                        type="number"
                        min={0}
                        value={editing ? editChildren : detail.guests.children ?? ""}
                        disabled={!editing}
                        onChange={(e) => setEditChildren(e.target.value)}
                      />
                    </label>
                    <label className="ops-label">
                      <span>Infants</span>
                      <input
                        className="ops-input"
                        type="number"
                        min={0}
                        value={editing ? editInfants : detail.guests.infants ?? ""}
                        disabled={!editing}
                        onChange={(e) => setEditInfants(e.target.value)}
                      />
                    </label>
                    <label className="ops-label">
                      <span>Total</span>
                      <input
                        className="ops-input"
                        type="number"
                        min={0}
                        value={editing ? editTotalGuests : detail.guests.total ?? detail.guestCount ?? ""}
                        disabled={!editing}
                        onChange={(e) => setEditTotalGuests(e.target.value)}
                      />
                    </label>
                  </div>
                </section>

                <section className="ops-booking-modal-section">
                  <h3>Money</h3>
                  <div className="ops-booking-grid-2">
                    <label className="ops-label">
                      <span>Total value</span>
                      <input
                        className="ops-input"
                        type="number"
                        min={0}
                        step="0.01"
                        value={editing ? editTotalValue : detail.money.total ?? ""}
                        disabled={!editing}
                        onChange={(e) => setEditTotalValue(e.target.value)}
                      />
                    </label>
                    <label className="ops-label">
                      <span>Currency</span>
                      <input
                        className="ops-input"
                        value={editing ? editCurrency : detail.money.currency ?? ""}
                        disabled={!editing}
                        onChange={(e) => setEditCurrency(e.target.value)}
                      />
                    </label>
                  </div>
                  <p>
                    <strong>Cleaning fee:</strong> {detail.money.cleaningFee ?? "-"}
                  </p>
                  <p>
                    <strong>Taxes:</strong> {detail.money.taxes ?? "-"}
                  </p>
                  <p>
                    <strong>Payout:</strong> {detail.money.payout ?? "-"}
                  </p>
                  <p>
                    <strong>Guest paid:</strong> {detail.money.guestPaid ?? "-"}
                  </p>
                </section>

                <section className="ops-booking-modal-section">
                  <h3>Hosthub notes</h3>
                  {detail.notesTimeline.length === 0 ? (
                    <p className="ops-muted">No notes returned from Hosthub.</p>
                  ) : (
                    <ul className="ops-drawer-list">
                      {detail.notesTimeline.map((note, idx) => (
                        <li key={`${note.id ?? "note"}-${idx}`} className="ops-drawer-row">
                          <strong>{note.content ?? "(empty)"}</strong>
                          <div className="ops-muted">
                            {note.created ?? "-"} | {note.status ?? "-"}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="ops-booking-modal-section">
                  <h3>All Hosthub fields</h3>
                  {detail.payloadSections.length === 0 ? (
                    <p className="ops-muted">No payload fields available.</p>
                  ) : (
                    <div className="ops-payload-sections">
                      {detail.payloadSections.map((section) => (
                        <div key={section.id} className="ops-payload-section">
                          <h4>{section.title}</h4>
                          <div className="ops-payload-grid">
                            {section.fields.map((field, fieldIndex) => (
                              <div key={`${section.id}-${field.key}-${fieldIndex}`} className="ops-payload-row">
                                <div className="ops-payload-label">{field.label}</div>
                                <div className="ops-payload-value">{field.value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="ops-booking-modal-section">
                  <h3>Other</h3>
                  <label className="ops-label">
                    <span>Action</span>
                    <input
                      className="ops-input"
                      value={editing ? editAction : detail.action ?? ""}
                      disabled={!editing}
                      onChange={(e) => setEditAction(e.target.value)}
                    />
                  </label>
                  <label className="ops-label">
                    <span>Notes</span>
                    <textarea
                      className="ops-input"
                      rows={4}
                      value={editing ? editNotes : detail.notes ?? ""}
                      disabled={!editing}
                      onChange={(e) => setEditNotes(e.target.value)}
                    />
                  </label>
                </section>

                <section className="ops-booking-modal-section">
                  <h3>Raw payload</h3>
                  <pre className="ops-pre">{prettyJson(detail.rawPayload)}</pre>
                </section>
                <section className="ops-booking-modal-section">
                  <h3>Hosthub event raw</h3>
                  <pre className="ops-pre">{prettyJson(detail.hosthub.calendarEventRaw)}</pre>
                </section>
                <section className="ops-booking-modal-section">
                  <h3>Hosthub GR taxes raw</h3>
                  <pre className="ops-pre">{prettyJson(detail.hosthub.grTaxesRaw)}</pre>
                </section>

                <div className="ops-modal-actions">
                  {editing ? (
                    <button className="ops-btn ops-btn-primary" type="button" disabled={saving} onClick={() => void onSave()}>
                      {saving ? "Saving..." : "Save locally"}
                    </button>
                  ) : null}
                  <button className="ops-btn" type="button" onClick={closeModal}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {toast ? <div className="ops-toast">{toast}</div> : null}
    </main>
  );
}

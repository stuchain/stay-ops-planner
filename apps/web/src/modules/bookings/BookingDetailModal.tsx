"use client";

import { useCallback, useEffect, useState } from "react";
import type { BookingStatus } from "@stay-ops/db";
import { ChannelLogo } from "./ChannelLogo";
import type { BookingDetailDto } from "./details";

type BookingDetail = BookingDetailDto;

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

export type BookingDetailModalProps = {
  bookingId: string | null;
  onClose: () => void;
  /** Called after successful PATCH save. */
  onAfterSave?: () => void | Promise<void>;
};

export function BookingDetailModal({ bookingId, onClose, onAfterSave }: BookingDetailModalProps) {
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<"" | BookingStatus>("");
  const [editGuestName, setEditGuestName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAdults, setEditAdults] = useState("");
  const [editChildren, setEditChildren] = useState("");
  const [editInfants, setEditInfants] = useState("");
  const [editTotalGuests, setEditTotalGuests] = useState("");
  const [editTotalValue, setEditTotalValue] = useState("");
  const [editCurrency, setEditCurrency] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editAction, setEditAction] = useState("");

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setEditing(false);
    try {
      const res = await fetch(`/api/bookings/${id}`, {
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

  useEffect(() => {
    if (!bookingId) {
      setDetail(null);
      return;
    }
    void loadDetail(bookingId);
  }, [bookingId, loadDetail]);

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
    if (!bookingId || !detail) return;
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
      const res = await fetch(`/api/bookings/${bookingId}`, {
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
      await onAfterSave?.();
    } catch {
      setToast("Failed to save booking");
    } finally {
      setSaving(false);
    }
  }, [
    bookingId,
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
    onAfterSave,
  ]);

  if (!bookingId) return null;

  return (
    <>
      <div
        className="ops-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Booking details"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
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
                  <button className="ops-btn" type="button" onClick={() => void onCopy()}>
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
                <button className="ops-btn" type="button" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {toast ? <div className="ops-toast">{toast}</div> : null}
    </>
  );
}

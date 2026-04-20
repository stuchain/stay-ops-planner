"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BookingStatus } from "@stay-ops/db";
import { ChannelLogo } from "./ChannelLogo";
import type { BookingDetailDto } from "./details";

type BookingDetail = BookingDetailDto;

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

function fmtDateTimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function statusLabel(status: BookingStatus): string {
  if (status === "needs_reassignment") return "Needs reassignment";
  if (status === "no_show") return "No show";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export type BookingDetailModalProps = {
  bookingId: string | null;
  onClose: () => void;
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

  const guestTotalText = useMemo(() => detail?.guests.total ?? detail?.guestCount ?? "-", [detail]);

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
              <div className="ops-booking-popup-summary">
                <div className="ops-booking-popup-status">
                  <span>{statusLabel(editing ? editStatus || detail.status : detail.status)}</span>
                </div>
                <div className="ops-booking-popup-main">
                  <div className="ops-booking-popup-identity">
                    <span className="ops-name-with-logo">
                      <ChannelLogo channel={detail.channel} className="ops-channel-logo" />
                      <strong>{editing ? editGuestName || detail.guestName : detail.guestName}</strong>
                    </span>
                    <span className="ops-muted">{detail.assignedRentalName ?? "Unassigned"}</span>
                  </div>
                  <div className="ops-booking-popup-stay">
                    <div>
                      <div className="ops-muted">Check-in</div>
                      <strong>{fmtDate(detail.checkinDate)}</strong>
                    </div>
                    <div>
                      <div className="ops-muted">Checkout</div>
                      <strong>{fmtDate(detail.checkoutDate)}</strong>
                    </div>
                    <div>
                      <div className="ops-muted">Stay</div>
                      <strong>
                        {detail.nights} nights | {guestTotalText} guests
                      </strong>
                    </div>
                  </div>
                  <div className="ops-booking-popup-total">{fmtMoney(detail.money.total, detail.money.currency)}</div>
                </div>
              </div>

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

              <details className="ops-booking-modal-section" open>
                <summary>Booking Details</summary>
                <div className="ops-booking-grid-2">
                  <div className="ops-detail-row">
                    <span className="ops-detail-key">Channel</span>
                    <span className="ops-detail-value">{detail.channel}</span>
                  </div>
                  <div className="ops-detail-row">
                    <span className="ops-detail-key">Room assigned</span>
                    <span className="ops-detail-value">{detail.assignedRentalName ?? "-"}</span>
                  </div>
                  <div className="ops-detail-row">
                    <span className="ops-detail-key">Date and time created</span>
                    <span className="ops-detail-value">{fmtDateTimeLocal(detail.createdAt)}</span>
                  </div>
                  <div className="ops-detail-row">
                    <span className="ops-detail-key">Date and time updated</span>
                    <span className="ops-detail-value">{fmtDateTimeLocal(detail.updatedAt)}</span>
                  </div>
                  <label className="ops-detail-row ops-detail-row-edit">
                    <span className="ops-detail-key">Adult guests</span>
                    <input
                      className="ops-input ops-detail-input"
                      type="number"
                      min={0}
                      value={editing ? editAdults : detail.guests.adults ?? ""}
                      disabled={!editing}
                      onChange={(e) => setEditAdults(e.target.value)}
                    />
                  </label>
                  <label className="ops-detail-row ops-detail-row-edit">
                    <span className="ops-detail-key">Children guests</span>
                    <input
                      className="ops-input ops-detail-input"
                      type="number"
                      min={0}
                      value={editing ? editChildren : detail.guests.children ?? ""}
                      disabled={!editing}
                      onChange={(e) => setEditChildren(e.target.value)}
                    />
                  </label>
                  <div className="ops-detail-row">
                    <span className="ops-detail-key">Children ages</span>
                    <span className="ops-detail-value">{detail.guests.childrenAges || "-"}</span>
                  </div>
                </div>
              </details>

              <details className="ops-booking-modal-section" open>
                <summary>Guest Details</summary>
                <div className="ops-booking-grid-2">
                  <label className="ops-detail-row ops-detail-row-edit">
                    <span className="ops-detail-key">Email</span>
                    <input
                      className="ops-input ops-detail-input"
                      value={editing ? editEmail : detail.contact.email ?? ""}
                      disabled={!editing}
                      onChange={(e) => setEditEmail(e.target.value)}
                    />
                  </label>
                  <label className="ops-detail-row ops-detail-row-edit">
                    <span className="ops-detail-key">Phone number</span>
                    <input
                      className="ops-input ops-detail-input"
                      value={editing ? editPhone : detail.contact.phone ?? ""}
                      disabled={!editing}
                      onChange={(e) => setEditPhone(e.target.value)}
                    />
                  </label>
                  <div className="ops-detail-row">
                    <span className="ops-detail-key">Country</span>
                    <span className="ops-detail-value">{detail.contact.country ?? "-"}</span>
                  </div>
                  <div className="ops-detail-row">
                    <span className="ops-detail-key">ID</span>
                    <span className="ops-detail-value">{detail.contact.id ?? "-"}</span>
                  </div>
                </div>
              </details>

              <details className="ops-booking-modal-section" open>
                <summary>Price Details</summary>
                <div className="ops-booking-grid-2">
                  <div className="ops-detail-row"><span className="ops-detail-key">Booking value</span><span className="ops-detail-value">{fmtMoney(detail.money.total, detail.money.currency)}</span></div>
                  <div className="ops-detail-row"><span className="ops-detail-key">Total payout</span><span className="ops-detail-value">{fmtMoney(detail.money.payout, detail.money.currency)}</span></div>
                  <div className="ops-detail-row"><span className="ops-detail-key">Cleaning fee</span><span className="ops-detail-value">{fmtMoney(detail.money.cleaningFee, detail.money.currency)}</span></div>
                  <div className="ops-detail-row"><span className="ops-detail-key">Other fees</span><span className="ops-detail-value">{fmtMoney(detail.money.otherFees, detail.money.currency)}</span></div>
                  <div className="ops-detail-row"><span className="ops-detail-key">Payment charges</span><span className="ops-detail-value">{fmtMoney(detail.money.paymentCharges, detail.money.currency)}</span></div>
                  <div className="ops-detail-row"><span className="ops-detail-key">Service fee host</span><span className="ops-detail-value">{fmtMoney(detail.money.serviceFeeHost, detail.money.currency)}</span></div>
                  <div className="ops-detail-row"><span className="ops-detail-key">Service fee host base</span><span className="ops-detail-value">{fmtMoney(detail.money.serviceFeeHostBase, detail.money.currency)}</span></div>
                  <div className="ops-detail-row"><span className="ops-detail-key">Service fee host VAT</span><span className="ops-detail-value">{fmtMoney(detail.money.serviceFeeHostVat, detail.money.currency)}</span></div>
                  <div className="ops-detail-row"><span className="ops-detail-key">Extra taxes</span><span className="ops-detail-value">{fmtMoney(detail.money.extraTaxes, detail.money.currency)}</span></div>
                  <div className="ops-detail-row"><span className="ops-detail-key">Collected by channel</span><span className="ops-detail-value">{fmtMoney(detail.money.collectedByChannel, detail.money.currency)}</span></div>
                  <div className="ops-detail-row"><span className="ops-detail-key">Guest paid</span><span className="ops-detail-value">{fmtMoney(detail.money.guestPaid, detail.money.currency)}</span></div>
                </div>
              </details>

              <details className="ops-booking-modal-section">
                <summary>Hosthub notes</summary>
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
              </details>

              <details className="ops-booking-modal-section">
                <summary>All Hosthub fields</summary>
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
              </details>

              <details className="ops-booking-modal-section">
                <summary>Raw payload and Hosthub raw</summary>
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
              </details>

              <section className="ops-booking-modal-section">
                <h3>Other editable fields</h3>
                <div className="ops-booking-grid-2">
                  <label className="ops-label">
                    <span>Status</span>
                    <select
                      className="ops-input"
                      value={editing ? editStatus : detail.status}
                      disabled={!editing}
                      onChange={(e) => setEditStatus(e.target.value as BookingStatus)}
                    >
                      <option value="pending">pending</option>
                      <option value="confirmed">confirmed</option>
                      <option value="cancelled">cancelled</option>
                      <option value="completed">completed</option>
                      <option value="no_show">no_show</option>
                      <option value="needs_reassignment">needs_reassignment</option>
                    </select>
                  </label>
                  <label className="ops-label">
                    <span>Guest name</span>
                    <input
                      className="ops-input"
                      value={editing ? editGuestName : detail.guestName}
                      disabled={!editing}
                      onChange={(e) => setEditGuestName(e.target.value)}
                    />
                  </label>
                  <label className="ops-label">
                    <span>Total guests</span>
                    <input
                      className="ops-input"
                      type="number"
                      min={0}
                      value={editing ? editTotalGuests : detail.guests.total ?? detail.guestCount ?? ""}
                      disabled={!editing}
                      onChange={(e) => setEditTotalGuests(e.target.value)}
                    />
                  </label>
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
                  <label className="ops-label">
                    <span>Action</span>
                    <input
                      className="ops-input"
                      value={editing ? editAction : detail.action ?? ""}
                      disabled={!editing}
                      onChange={(e) => setEditAction(e.target.value)}
                    />
                  </label>
                </div>
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

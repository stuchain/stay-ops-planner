"use client";

import { useEffect, useState } from "react";

type AlertTemplateDto = {
  id: string;
  eventType: string;
  channel: string;
  templateVersion: number;
  title: string | null;
  body: string;
  enabled: boolean;
};

type ThresholdDto = {
  id: string;
  key: string;
  numericValue: string | null;
  stringValue: string | null;
  unit: string | null;
  notes: string | null;
  enabled: boolean;
};

type TemplatesResponse = { data: AlertTemplateDto[] };
type ThresholdsResponse = { data: ThresholdDto[] };
type ApiError = { error?: { message?: string } };

const ALERT_EVENTS = [
  "sync_run_failed",
  "unassigned_backlog_threshold_reached",
  "cleaning_overdue",
  "conflict_resolution_required",
] as const;

const ALERT_CHANNELS = ["sms", "whatsapp"] as const;

const THRESHOLD_KEYS = [
  "unassigned_backlog_count",
  "unassigned_backlog_window_hours",
  "cleaning_overdue_minutes",
  "conflict_resolution_sla_minutes",
  "sync_failure_suppression_minutes",
] as const;

type AlertEvent = (typeof ALERT_EVENTS)[number];
type AlertChannel = (typeof ALERT_CHANNELS)[number];
type ThresholdKey = (typeof THRESHOLD_KEYS)[number];

export function AdminConfigurationView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<AlertTemplateDto[]>([]);
  const [thresholds, setThresholds] = useState<ThresholdDto[]>([]);

  const [templateForm, setTemplateForm] = useState<{
    eventType: AlertEvent;
    channel: AlertChannel;
    templateVersion: number;
    title: string;
    body: string;
    enabled: boolean;
  }>({
    eventType: ALERT_EVENTS[0],
    channel: ALERT_CHANNELS[0],
    templateVersion: 1,
    title: "",
    body: "",
    enabled: true,
  });

  const [thresholdForm, setThresholdForm] = useState<{
    key: ThresholdKey;
    numericValue: string;
    stringValue: string;
    unit: string;
    notes: string;
    enabled: boolean;
  }>({
    key: THRESHOLD_KEYS[0],
    numericValue: "",
    stringValue: "",
    unit: "",
    notes: "",
    enabled: true,
  });

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [templatesRes, thresholdsRes] = await Promise.all([
        fetch("/api/admin/config/templates", { credentials: "include" }),
        fetch("/api/admin/config/thresholds", { credentials: "include" }),
      ]);
      if (!templatesRes.ok) {
        const err = (await templatesRes.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Templates HTTP ${templatesRes.status}`);
      }
      if (!thresholdsRes.ok) {
        const err = (await thresholdsRes.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Thresholds HTTP ${thresholdsRes.status}`);
      }
      const templatesJson = (await templatesRes.json()) as TemplatesResponse;
      const thresholdsJson = (await thresholdsRes.json()) as ThresholdsResponse;
      setTemplates(templatesJson.data);
      setThresholds(thresholdsJson.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admin configuration");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function createOrUpdateTemplate() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/config/templates", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventType: templateForm.eventType,
          channel: templateForm.channel,
          templateVersion: templateForm.templateVersion,
          title: templateForm.title || null,
          body: templateForm.body,
          enabled: templateForm.enabled,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Template save HTTP ${res.status}`);
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  async function createOrUpdateThreshold() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/config/thresholds", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: thresholdForm.key,
          numericValue: thresholdForm.numericValue.length ? Number(thresholdForm.numericValue) : null,
          stringValue: thresholdForm.stringValue || null,
          unit: thresholdForm.unit || null,
          notes: thresholdForm.notes || null,
          enabled: thresholdForm.enabled,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(err?.error?.message ?? `Threshold save HTTP ${res.status}`);
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save threshold");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="ops-calendar-main">
      <header className="ops-calendar-header">
        <h1>Admin configuration</h1>
      </header>

      {loading && <p className="ops-muted">Loading configuration…</p>}
      {error && <p className="ops-error">{error}</p>}

      {!loading && (
        <>
          <section className="ops-markers">
            <h2>Alert template configuration</h2>
            <div className="ops-cleaning-filters">
              <label className="ops-label">
                Event type
                <select
                  className="ops-input"
                  value={templateForm.eventType}
                  onChange={(e) => setTemplateForm((s) => ({ ...s, eventType: e.target.value as (typeof ALERT_EVENTS)[number] }))}
                >
                  {ALERT_EVENTS.map((eventType) => (
                    <option key={eventType} value={eventType}>
                      {eventType}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ops-label">
                Channel
                <select
                  className="ops-input"
                  value={templateForm.channel}
                  onChange={(e) => setTemplateForm((s) => ({ ...s, channel: e.target.value as (typeof ALERT_CHANNELS)[number] }))}
                >
                  {ALERT_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {channel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ops-label">
                Version
                <input
                  className="ops-input"
                  type="number"
                  min={1}
                  value={templateForm.templateVersion}
                  onChange={(e) => setTemplateForm((s) => ({ ...s, templateVersion: Number(e.target.value) || 1 }))}
                />
              </label>
              <label className="ops-label">
                Title
                <input
                  className="ops-input"
                  value={templateForm.title}
                  onChange={(e) => setTemplateForm((s) => ({ ...s, title: e.target.value }))}
                />
              </label>
            </div>
            <label className="ops-label">
              Body
              <textarea
                className="ops-input"
                value={templateForm.body}
                onChange={(e) => setTemplateForm((s) => ({ ...s, body: e.target.value }))}
              />
            </label>
            <label className="ops-label">
              <input
                type="checkbox"
                checked={templateForm.enabled}
                onChange={(e) => setTemplateForm((s) => ({ ...s, enabled: e.target.checked }))}
              />{" "}
              Enabled
            </label>
            <button className="ops-btn ops-btn-primary" disabled={saving || !templateForm.body} onClick={() => void createOrUpdateTemplate()}>
              Save template
            </button>
            <p className="ops-muted">Configured templates: {templates.length}</p>
            <pre className="ops-pre">{JSON.stringify(templates, null, 2)}</pre>
          </section>

          <section className="ops-markers">
            <h2>Operational threshold configuration</h2>
            <div className="ops-cleaning-filters">
              <label className="ops-label">
                Key
                <select
                  className="ops-input"
                  value={thresholdForm.key}
                  onChange={(e) => setThresholdForm((s) => ({ ...s, key: e.target.value as (typeof THRESHOLD_KEYS)[number] }))}
                >
                  {THRESHOLD_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ops-label">
                Numeric value
                <input
                  className="ops-input"
                  value={thresholdForm.numericValue}
                  onChange={(e) => setThresholdForm((s) => ({ ...s, numericValue: e.target.value }))}
                />
              </label>
              <label className="ops-label">
                String value
                <input
                  className="ops-input"
                  value={thresholdForm.stringValue}
                  onChange={(e) => setThresholdForm((s) => ({ ...s, stringValue: e.target.value }))}
                />
              </label>
              <label className="ops-label">
                Unit
                <input className="ops-input" value={thresholdForm.unit} onChange={(e) => setThresholdForm((s) => ({ ...s, unit: e.target.value }))} />
              </label>
              <label className="ops-label">
                Notes
                <input
                  className="ops-input"
                  value={thresholdForm.notes}
                  onChange={(e) => setThresholdForm((s) => ({ ...s, notes: e.target.value }))}
                />
              </label>
            </div>
            <label className="ops-label">
              <input
                type="checkbox"
                checked={thresholdForm.enabled}
                onChange={(e) => setThresholdForm((s) => ({ ...s, enabled: e.target.checked }))}
              />{" "}
              Enabled
            </label>
            <button className="ops-btn ops-btn-primary" disabled={saving} onClick={() => void createOrUpdateThreshold()}>
              Save threshold
            </button>
            <p className="ops-muted">Configured thresholds: {thresholds.length}</p>
            <pre className="ops-pre">{JSON.stringify(thresholds, null, 2)}</pre>
          </section>
        </>
      )}
    </main>
  );
}

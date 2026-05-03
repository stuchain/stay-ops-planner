# Runbook: Sync Failure

## Severity
- **SEV-2** if booking import is delayed > 30 minutes.
- **SEV-1** if all sync runs fail for > 2 hours.

## Detection
- `/app/dashboard` shows falling sync success ratio.
- `GET /api/sync/runs` latest statuses are `failed`.
- Import errors rising rapidly in unresolved count.

## Triage
1. Check latest webhook/poll logs for provider errors.
2. Confirm `HOSTHUB_API_TOKEN`, webhook secret, and Redis connectivity.
3. Confirm queue worker process is healthy.

## Mitigation
1. Restart sync worker process.
2. Trigger one manual reconcile run.
3. Pause noisy retries if provider is rate-limiting.

## Rollback
- Revert latest sync-related deployment if failures started after release.
- Disable webhook ingestion temporarily and rely on poll reconciliation.

## Verification
- At least one successful sync run in `/api/sync/runs`.
- Import error growth returns to baseline.
- Calendar updates reflect newly imported bookings.

## Καταλύματα Hosthub shows fewer listings than expected

The Settings page table **Καταλύματα Hosthub** lists every row in `source_listings` (no per-user filter). If you only see a handful of rows, the database only has that many listing rows — usually because only those listings have appeared in synced Hosthub calendar events for this environment.

### Triage (Settings UI)

1. Open **Settings** as **operator** or **admin**.
2. In **Hosthub diagnostics**, click **Refresh diagnostics** and note **Listings in DB** and the **Poll cursor** on the latest `hosthub_poll` run.
3. As **admin**, click **Run Hosthub probe (first page)**. This performs a single read-only Hosthub list call (first page only) and shows **distinct listings on page** vs DB totals.

Interpretation:

- **Probe shows more distinct listings on the first page than exist in the DB** (or you expect many more pages but the DB never grew): the incremental poll **cursor** (`updated_gte`) may be ahead of older events, or the DB was recreated. As **admin**, use **Reset sync watermark and re-sync** (or `POST /api/admin/sync/hosthub/reset-cursor` then **Sync now**). Log out and back in if your session is not `admin` — the reset endpoint is admin-only; promote an account with `pnpm --filter @stay-ops/db run create-user` and `CREATE_USER_ROLE=admin` if needed.
- **Probe distinct count is similar to DB total** and stays small after a full re-sync: the **Hosthub API token** likely only has access to those rentals. Generate or paste a token with full account scope in Hosthub, then save in **Hosthub token** and sync again.
- **Probe error (401/403)** or token missing: fix the token in **Hosthub token** and retry.
- **Recent import errors** shown in diagnostics: inspect the message on the latest rows before retrying; see `import_errors` in the DB if needed.

### API equivalents

- `GET /api/admin/sync/hosthub/diag` — operator or admin (DB snapshot).
- `GET /api/admin/sync/hosthub/diag?overlapYear=2026` — adds `excelListingsBookingCounts.overlapYearUtc` (total / with listing / orphan for that UTC overlap year).
- `GET /api/admin/sync/hosthub/diag?probeHosthub=true` — **admin only** (adds live first-page Hosthub probe).
- `POST /api/admin/sync/hosthub/reset-cursor` — **admin only**; clears `cursor` on all `sync_runs` where `source = hosthub_poll`, writes an audit event, then run **Sync now** to re-pull from the beginning (subject to Hosthub pagination and token scope).
- `POST /api/sync/hosthub/reconcile` — **operator or admin**; optional JSON body `{ "fullSync": true }` runs one reconcile with `updated_gte` omitted (full visible history from Hosthub’s first page), same advisory lock and rate limits as **Sync now**. Does **not** clear stored poll cursors on past runs (unlike admin **Reset sync watermark and re-sync**). Use admin reset if the watermark itself is wrong.

### Settings: «Κρατήσεις» vs Hosthub script totals

- **`pnpm hosthub:count-bookings`** (no flags) counts **all** Hosthub `Booking`-type calendar rows returned with `updated_gte=0` pagination — **all dates**, not only the year selected in Settings.
- **`pnpm hosthub:count-bookings -- --overlap-year 2026`** counts the same rows filtered by **UTC calendar-year overlap** (check-out exclusive), aligned with **`GET /api/excel/listings?year=2026`**. Compare `api_bookings_overlap_year` to the **sum** of the **Κρατήσεις** column (each booking appears under **one** channel row only).
- If all-time `bookings` table count is far below the script’s unfiltered `bookings` total, run recovery: optional **`{ "fullSync": true }`** reconcile, admin **reset-cursor** if needed, env `HOSTHUB_CALENDAR_EVENTS_IS_VISIBLE=all` or `HOSTHUB_RECONCILE_PER_RENTAL_CALENDAR=1` for edge cases.

## Communication template
- Incident: Sync pipeline degraded.
- Impact: Booking updates delayed.
- Mitigation in progress: worker restart and manual reconcile.
- Next update: <time + 30m>.

## On-call
- Primary / secondary rotation: document the current roster in your team wiki or PagerDuty schedule and link it here.
- Escalation: page secondary if no acknowledgment within 15 minutes for SEV-1.

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

## Communication template
- Incident: Sync pipeline degraded.
- Impact: Booking updates delayed.
- Mitigation in progress: worker restart and manual reconcile.
- Next update: <time + 30m>.

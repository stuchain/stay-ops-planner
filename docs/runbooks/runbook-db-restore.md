# Runbook: Database Restore

## Severity
- **SEV-1** for production data corruption or destructive migration.
- **SEV-2** for non-prod restore failures.

## Detection
- Backup restore verification script fails.
- Data integrity checks fail (missing bookings/assignments).

## Triage
1. Confirm incident scope (prod vs non-prod).
2. Select latest valid backup artifact (`backup-YYYY-MM-DD-HHmm.sql.gz`).
3. Verify target restore DB endpoint and access credentials.

## Mitigation
1. Follow `docs/runbooks/db-backup-restore.md` restore verification flow.
2. Restore into isolated DB first; verify health and row counts.
3. Switch application to restored DB only after checks pass.

## Rollback
- If restore attempt fails, keep traffic on current DB and escalate to DBA/platform support.
- Retry with prior backup artifact if latest artifact is corrupt.

## Verification
- `GET /api/health` returns `status=ok`.
- Spot-check booking, assignment, cleaning task counts.
- Core workflows (login, calendar, assignment) succeed.

## Communication template
- Incident: DB restore in progress.
- Backup artifact: <artifact-name>.
- Current status: <restoring/verifying/complete>.
- Next update: <time>.

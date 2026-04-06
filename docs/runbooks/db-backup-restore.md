# Postgres Backup And Restore Verification

## Scope
- Daily PostgreSQL logical backup creation.
- Retention cleanup for 12 months.
- Weekly non-production restore verification.
- Monthly disaster recovery drill checklist.

## Daily backup job
- Schedule: once daily at off-peak (recommended `02:15 UTC`).
- Command:
  - `pnpm backup:pg`
- Output format:
  - `backups/postgres/backup-YYYY-MM-DD-HHmm.sql.gz`

## Retention policy
- Keep 365 days of artifacts (12 months).
- Command:
  - `pnpm backup:prune`
- Optional override:
  - `BACKUP_RETENTION_DAYS=365`

## Weekly restore verification (non-prod DB)
1. Pick latest artifact in `backups/postgres/`.
2. Set restore target:
   - `RESTORE_DATABASE_URL=<staging_or_temp_db_url>`
3. Run:
   - `pnpm backup:verify-restore -- backups/postgres/backup-YYYY-MM-DD-HHmm.sql.gz`
4. Confirm output contains:
   - `Restore verification succeeded.`
   - `healthcheck = 1`
   - bookings row count.

## Monthly DR drill checklist
- Restore latest backup to isolated non-production database.
- Execute smoke checks:
  - auth login endpoint,
  - calendar month endpoint,
  - unassigned queue endpoint.
- Record drill date, operator, artifact name, and outcomes in ops log.
- Create follow-up issues for any restore regression.

## Security notes
- Store backup artifacts in encrypted-at-rest storage.
- Restrict access to operators with incident-response privileges.
- Do not upload backup artifacts to source control.

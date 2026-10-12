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

## Production daily backup (GitHub Actions, Neon)
- Workflow: `.github/workflows/daily-backup.yml`, runs every day at `01:30 UTC` and can be started by hand (Actions > Daily database backup > Run workflow).
- Secret: `DATABASE_URL` in the GitHub Environment `production` (the same one "Migrate production DB" uses). Use Neon's **direct, non-pooled** connection string (host without `-pooler`, with `sslmode=require`); pg_dump does not work reliably through the pooler. The workflow fails with `::error::Missing secret DATABASE_URL in the production environment` if it is not set, and never prints the value.
- Output: custom-format dump `stay-ops-YYYY-MM-DD.dump` (UTC date), made with `pg_dump -Fc --no-owner --no-privileges` using the `postgres:17` docker image (matches Neon's Postgres 17; pg_dump refuses a newer server). The job fails if the file is empty or `pg_restore --list` cannot read it.
- Encryption: the repository is public, and artifacts of a public repository can be downloaded by anyone signed in to GitHub, so the dump is encrypted (gpg, AES-256) with the secret `BACKUP_PASSPHRASE` (20+ characters, in the same `production` environment) before upload; the readable dump is never uploaded. Keep a copy of the passphrase in a password manager: without it the backups cannot be restored. The workflow fails if the secret is missing.
- Where: Actions > Daily database backup > the run > Artifacts (artifact `stay-ops-db-YYYY-MM-DD`, a zip; unzip to get `stay-ops-YYYY-MM-DD.dump.gpg`). Artifacts are kept for 30 days. A red run means no backup was made that day; check it the same day.
- Use a `pg_restore` of version 17 or newer for the commands below.

### Restore a dump into a new Neon branch
1. Download the artifact from the run, unzip it, and decrypt it (gpg asks for `BACKUP_PASSPHRASE`):
   - `gpg --output stay-ops-YYYY-MM-DD.dump --decrypt stay-ops-YYYY-MM-DD.dump.gpg`
2. In the Neon console, create a new branch (from the current state, or from an empty branch). Never restore over the production branch.
3. Copy the new branch's **direct** connection string and export it:
   - `export BRANCH_URL='postgresql://...@<branch-host>/<db>?sslmode=require'`
4. Restore:
   - `pg_restore --no-owner --no-privileges --clean --if-exists -d "$BRANCH_URL" stay-ops-YYYY-MM-DD.dump`
   - Errors about objects that "do not exist" are suppressed by `--if-exists`; anything else should be investigated.
5. Check row counts against what you expect (compare with production when it is still reachable):
   - `psql "$BRANCH_URL" -c "select (select count(*) from bookings) as bookings, (select count(*) from rooms) as rooms"`
6. To run the app against the restored data (only if production is lost or corrupted): set `DATABASE_URL` in the Vercel Production environment to the branch's connection strings (pooled for `DATABASE_URL`, direct for migrations), then redeploy. Otherwise keep the branch for inspection and delete it afterwards.

## Retention policy
- Keep 365 days of artifacts (12 months).
- Command:
  - `pnpm backup:prune`
- Optional override:
  - `BACKUP_RETENTION_DAYS=365`

## Weekly restore verification (non-prod DB)
1. Pick latest artifact in `backups/postgres/` (and matching `backup-*.sql.gz.sha256` if present).
2. Set restore target:
   - `RESTORE_DATABASE_URL=<staging_or_temp_db_url>`
3. Run:
   - `pnpm backup:verify-restore -- backups/postgres/backup-YYYY-MM-DD-HHmm.sql.gz`
4. Confirm output contains:
   - `SHA256 checksum verified.` (when `.sha256` sidecar exists)
   - `Restore verification succeeded.`
   - `healthcheck = 1`
   - bookings row count.

## Appendix A retention (12 months)

- Schedule: `pnpm retention:prune` monthly (or use `RETENTION_MONTHS` override).
- Prunes `audit_events` and `sync_runs` older than the cutoff.

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

# Production Deployment (Vercel + Neon + Upstash)

## Stack
- Web: Vercel (`apps/web`)
- Database: Neon Postgres
- Queue/Cache: Upstash Redis

## Environment matrix
- `DATABASE_URL` (Neon pooled/prod connection string)
- `REDIS_URL` (Upstash Redis URL)
- `SESSION_SECRET` (>=32 chars, random)
- `APP_TIMEZONE` (default `Etc/UTC`)
- `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` (initial operator bootstrap only)
- Optional sync env:
  - `HOSTHUB_API_URL`
  - `HOSTHUB_API_TOKEN`
  - `HOSTHUB_WEBHOOK_SECRET`

## Deploy order
1. Validate env vars in platform config.
2. Run migrations:
   - `pnpm --filter @stay-ops/db migrate:deploy`
3. Deploy web app on Vercel.
4. Verify health endpoints:
   - Liveness (no DB): `GET /api/health/live`
   - Readiness (DB): `GET /api/health/ready` (alias: `GET /api/health`)
5. Verify readiness checks:
   - login endpoint,
   - calendar month endpoint,
   - queue worker connectivity (Redis reachable).

## Health vs readiness
- Health (`/api/health`) confirms process + DB connectivity.
- Readiness means operators can complete core workflows after deploy:
  - auth login,
  - assignment/reassign,
  - sync run query.

## Rollback path
1. Roll back Vercel deployment to previous known-good release.
2. If a migration is incompatible, apply documented migration recovery procedure in `docs/runbooks/migrations.md`.
3. Re-run `GET /api/health`.
4. Validate smoke checks before resuming normal traffic.

## MVP strict release gate
- Apply strict gate policy in `docs/runbooks/release-gate-mvp.md`.
- Capture execution evidence in the dated release evidence file (current cycle: `docs/runbooks/release-evidence-mvp-2026-04-07.md`).
- Do not proceed with production release unless all gate criteria are satisfied and sign-offs are complete.
- If admin configuration is part of release scope, execute `docs/runbooks/admin-configuration.md` post-deploy checks.

## Startup checks
- Ensure `SESSION_SECRET`, `DATABASE_URL`, and `REDIS_URL` are present.
- Treat missing required env as a hard startup failure.
- Use Neon and Upstash platform dashboards for connection health during incident triage.

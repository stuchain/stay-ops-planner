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
- `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` (initial **admin** bootstrap; seed upserts `role = admin`)
- `WEBHOOK_SECRET` (required in **non-development** for `POST /api/sync/hosthub/webhook`; fail-closed if missing)
- Optional sync env:
  - `HOSTHUB_API_URL`
  - `HOSTHUB_API_TOKEN`
  - `HOSTHUB_WEBHOOK_SECRET`
- RBAC: see [rbac-policy-matrix.md](../architecture/rbac-policy-matrix.md) for which APIs require `admin` vs `operator`.
- Observability (Sentry): `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, optional `SENTRY_USER_ID_PEPPER`. See [sentry-release.md](./sentry-release.md) for CI semver releases and sourcemaps.

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

## Automated post-deploy health checks (Epic 11)
- [`.github/workflows/health-check.yml`](../../.github/workflows/health-check.yml) listens for `deployment_status` events emitted by the Vercel GitHub integration. On `state == 'success'` it curls `${target_url}/api/health/ready` (3 attempts, exponential backoff), validates `status == "ok"` and `checks.db == "ok"`, and mirrors the result back as the `post-deploy-health` commit status visible on the PR/commit.
- On failure it also posts a structured comment on the associated PR carrying the `traceId` from `x-request-id` for Sentry/log correlation.
- Covers preview (every push) and production (`main`) automatically; nothing extra to wire when promoting deploys.
- Prerequisite: the Vercel GitHub integration must be configured to emit GitHub Deployments (default behaviour).
- Required middleware allowlist for unauthenticated probes: `/api/health`, `/api/health/live`, `/api/health/ready` are exempt from session checks (see [`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts)).

## CI/CD quality gates (Epic 11)
- Workflows run on **every push to `main` and on pull requests** (nothing in the repo ruleset blocks the push; CI is advisory unless you add required checks in GitHub again):
  - [`ci.yml`](../../.github/workflows/ci.yml) → `lint`, `typecheck`, `unit` (fast, no DB).
  - [`e2e.yml`](../../.github/workflows/e2e.yml) → `schema-drift`, `integration`, `playwright`.
- Schema-drift job runs `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code` on a clean shadow Postgres; any unmigrated `schema.prisma` change **fails that workflow run**. The integration job additionally runs `prisma migrate status` after `migrate deploy` to assert the live history is fully applied.
- Light ruleset (no PR requirement, no required-status gate) lives in [`.github/rulesets/main.json`](../../.github/rulesets/main.json). Apply or update with admin permissions:
  ```bash
  gh api -X POST \
    -H "Accept: application/vnd.github+json" \
    "repos/${GITHUB_REPOSITORY}/rulesets" \
    --input .github/rulesets/main.json
  ```
  See [`.github/rulesets/README.md`](../../.github/rulesets/README.md) for update/verification commands.

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

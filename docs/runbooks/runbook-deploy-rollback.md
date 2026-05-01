# Runbook: Deploy Rollback

## Severity
- **SEV-2** when deployment causes feature regression.
- **SEV-1** when deploy causes login/outage or data-path errors.

## Detection
- `/api/health` failing or degraded.
- Elevated 5xx rates after release.
- Operator workflows failing post-deploy.

## Triage
1. Identify first bad deployment version.
2. Confirm whether issue is app-only or migration-related.
3. Capture failing endpoint examples and logs.
4. If Sentry is enabled, search by `trace_id` / release (`stay-ops-web@<semver>`) — see [sentry-release.md](./sentry-release.md).

## Mitigation
1. Roll back to previous stable Vercel deployment.
2. If migration introduced incompatibility, follow `docs/runbooks/migrations.md`.
3. Validate Redis + DB connectivity after rollback.

## Rollback verification
- `GET /api/health` returns 200.
- Auth login, calendar, and assignment endpoints succeed (smoke with **`operator`** or **`admin`** session; admin-only routes such as `/api/admin/*` require **`admin`** — see [rbac-policy-matrix.md](../architecture/rbac-policy-matrix.md)).
- Queue worker processing resumes.

## Communication template
- Incident: Deployment rollback triggered.
- Cause: <known/under-investigation>.
- Action: reverted to release `<id>`.
- Validation: health + smoke checks passed/failed.
- Next update: <time>.

## On-call
- Use the same primary/secondary rotation documented for sync incidents (see [runbook-sync-failure.md](runbook-sync-failure.md)).

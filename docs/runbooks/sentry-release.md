# Sentry release and sourcemaps

## Prerequisites

- Sentry project + DSN for the web app.
- GitHub repository secrets (Settings → Secrets and variables → Actions):
  - `SENTRY_AUTH_TOKEN` — auth token with `project:releases` and `org:read` scopes.
  - `SENTRY_ORG` — organization slug.
  - `SENTRY_PROJECT` — project slug.

## Runtime environment (all environments)

Set in deployment or `.env` (see repo root `.env.example`):

| Variable | Purpose |
|----------|---------|
| `SENTRY_DSN` | Server-side ingest (API routes, RSC, worker). |
| `NEXT_PUBLIC_SENTRY_DSN` | Browser ingest. |
| `SENTRY_ENVIRONMENT` | Overrides `NODE_ENV` for the environment tag (e.g. `staging`). |
| `SENTRY_RELEASE` | **Semver release id**, e.g. `stay-ops-web@0.1.0` (must match CI build). |
| `SENTRY_USER_ID_PEPPER` | Optional extra entropy for hashed user ids in Sentry. |

## CI: tagged releases

Workflow: `.github/workflows/sentry-release.yml`

- Triggers on `workflow_dispatch` or `push` of tags matching `v*`.
- On **tag** pushes, the workflow **fails** if `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, or `SENTRY_PROJECT` is missing (so protected releases cannot ship without upload credentials).
- `SENTRY_RELEASE` is set to `stay-ops-web@<version>` where `<version>` is `apps/web/package.json` `version` (semver).

### Tagging a release

1. Bump `apps/web/package.json` `version` (semver).
2. Commit and push.
3. Create and push a git tag, e.g. `v0.1.0`.
4. Confirm the workflow run completed and the release appears in Sentry with uploaded artifacts.

## Worker (`@stay-ops/worker`)

The BullMQ worker initializes `@sentry/node` when `SENTRY_DSN` is set. Failed jobs call `Sentry.captureException` with queue and job metadata. Use the same `SENTRY_RELEASE` and `SENTRY_ENVIRONMENT` as the web app when possible.

## Redaction and user identity

- `beforeSend` scrubs sensitive keys (passwords, tokens, cookies, etc.) via `@stay-ops/shared/observability/redact`.
- API routes attach **hashed** user ids only (`hashUserId` + optional `SENTRY_USER_ID_PEPPER`), never raw emails or internal ids in `Sentry.setUser`.

## Incident triage

1. Copy `trace_id` / `x-request-id` from the API response or logs.
2. Search Sentry by tag `trace_id:<value>` or release `stay-ops-web@<semver>`.
3. Verify event extras do not contain redacted material; if they do, extend `packages/shared/src/observability/redact.ts`.

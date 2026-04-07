# Admin Configuration Runbook

## Purpose
Manage alert templates and operational thresholds from the internal admin UI and verify persistence through protected APIs.

## UI Entry Point
- Route: `/app/admin/configuration`
- Access: authenticated internal admin session.

## Managed Domains
- Alert templates (`eventType`, `channel`, `templateVersion`, `title`, `body`, `enabled`)
- Operational thresholds (`key`, `numericValue`, `stringValue`, `unit`, `notes`, `enabled`)

## API Endpoints
- `GET /api/admin/config/templates`
- `POST /api/admin/config/templates`
- `PATCH /api/admin/config/templates/:id`
- `GET /api/admin/config/thresholds`
- `POST /api/admin/config/thresholds`
- `PATCH /api/admin/config/thresholds/:id`

All routes are protected by `requireAdminSession`.

## Post-Deploy Verification
1. Sign in at `/login`.
2. Open `/app/admin/configuration`.
3. Create or update one template and confirm it appears in the template list.
4. Create or update one threshold and confirm it appears in the thresholds list.
5. Refresh page and verify both values persist.
6. Confirm audit rows are written in `audit_events` for create/update actions.

## Rollback Notes
- If migration rollback is required, follow `docs/runbooks/migrations.md`.
- If UI/API regression is detected, roll back web deployment and re-run verification steps above.

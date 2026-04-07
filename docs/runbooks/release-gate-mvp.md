# MVP Release Gate (Strict)

## Purpose
Define a strict release gate for MVP readiness with explicit no-go rules.

## MVP Scope Lock
- MVP scope is acceptance through Phase 8.
- Phase 9 alerting is design-only and out of runtime release scope.
- Runtime release decisions for MVP must not depend on Phase 9 implementation.

## Source of Truth
- `README.md` for current MVP capabilities and verification commands.
- `docs/runbooks/production-deploy.md` for deploy, health, readiness, and rollback checks.
- `docs/phases/phase-09-alerts-design.md` to confirm alerts remain out of MVP runtime scope.

## Hard Go/No-Go Policy
Release is **No-Go** if any of the following is true:
- Scope is ambiguous (MVP vs post-MVP features not explicitly separated).
- Any mandatory verification gate is incomplete or lacks evidence.
- Any P0/P1 production risk remains unresolved or unowned.
- Rollback procedure is not validated for the target release.

Release is **Go** only when all mandatory gates are complete with timestamped evidence and owner sign-off.

## Gate 2: Immutable Test Matrix
All commands below are mandatory and must pass for MVP release readiness.

### Required command set
1. `pnpm lint`
2. `pnpm build`
3. `pnpm test`
4. `pnpm --filter @stay-ops/web test:e2e` or `pnpm e2e:local`

### Environment preconditions
- Node version satisfies repository engine requirement (`>=20`).
- `pnpm` version matches repository package manager pin.
- Postgres and Redis are running and reachable.
- Required environment variables are present for web, DB, and sync modules.
- Bootstrap/e2e admin credentials are seeded and aligned with E2E config.

### Pass/fail policy
- Any non-zero exit code is an automatic no-go.
- Any missing precondition is an automatic no-go until corrected and re-run.
- Command outputs and timestamps must be recorded in the release evidence pack.

## Gate 3: Readiness and Workflow Probes
Run these probes in staging immediately before production release.

### Endpoint probes
- `GET /api/health/live` -> expect `200` and liveness payload.
- `GET /api/health/ready` -> expect `200` and readiness payload.
- `GET /api/health` -> expect readiness alias behavior consistent with deploy runbook.

### Critical workflow probes
- Auth login flow:
  - `POST /api/auth/login` with valid credentials -> expect `200`.
  - `GET /api/auth/me` after login -> expect `200` and session identity.
- Allocation flow:
  - `POST /api/assignments` for unassigned booking -> expect success response.
  - `PATCH /api/assignments/[id]/reassign` with valid target room -> expect success response.
- Sync visibility flow:
  - `GET /api/sync/runs` with admin session -> expect `200` and recent run list shape.
- Admin configuration flow:
  - `GET /api/admin/config/templates` and `GET /api/admin/config/thresholds` with admin session -> expect `200`.
  - Save one threshold from `/app/admin/configuration` and verify persisted payload is returned after reload.

### Escalation and stop conditions
- Any probe failure is an immediate no-go.
- On failure, open incident channel, assign incident owner, and capture failure evidence.
- Re-run the full probe set only after fix verification, not partial probes.

## Gate 4: Coverage Risk Register and Blocker Thresholds

### Blocker thresholds
- Any unresolved `P0` or `P1` risk is automatic no-go.
- Any `Medium` risk without named owner and due date is automatic no-go.
- Risks accepted for release require explicit approver and rationale in evidence pack.

### Current risk register (must be reviewed per release)
| Risk ID | Severity | Area | Description | Owner | Due date | Release status |
|---|---|---|---|---|---|---|
| RR-001 | High | Worker runtime | Worker bootstrap/shutdown path lacks direct test coverage. | Engineering | 2026-04-21 | Accepted (non-blocking for MVP; follow-up required) |
| RR-002 | Medium | E2E reliability | E2E suites can be skipped when env/seed preconditions drift. | Engineering | 2026-04-21 | Mitigated (seed lock + dedicated-port local gate) |
| RR-003 | Medium | Timezone correctness | Cleaning turnover logic includes placeholder timezone behavior. | Product + Engineering | 2026-04-21 | Accepted known limitation for post-MVP hardening |

### Verification requirements
- Cross-check risk entries against current test inventory under `apps/web/tests` and workspace package tests.
- Each risk must be either:
  - fixed with linked commit/test evidence, or
  - explicitly accepted with approver sign-off and expiry date.

## Gate 5: Evidence Pack and Sign-Off

### Required evidence artifact
- Create and maintain a dated evidence file:
  - `docs/runbooks/release-evidence-mvp-2026-04-07.md`
- The evidence file must include:
  - command execution summary and timestamps,
  - readiness probe outcomes,
  - rollback verification checklist,
  - risk disposition and sign-off results.

### Required sign-offs
- Engineering owner (test gate and probe completion).
- Operations owner (deploy/rollback readiness).
- Product owner (scope and release decision).

### Final decision rule
- `Go` only if all required sign-offs are marked approved and all blocker rules pass.
- Otherwise `No-Go`.

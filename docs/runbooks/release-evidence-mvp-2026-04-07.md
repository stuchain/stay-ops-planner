# MVP Release Evidence - 2026-04-07

## Scope Confirmation
- Scope: MVP through Phase 8.
- Explicitly excluded from runtime readiness: Phase 9 alerts implementation.
- Scope reference checked against `README.md` and `docs/phases/phase-09-alerts-design.md`.

## Command Gate Results
Record actual execution results for required commands.

| Command | Start (UTC) | End (UTC) | Result | Notes |
|---|---|---|---|---|
| `pnpm lint` | 2026-04-07 | 2026-04-07 | Passed | Root command now executes via `corepack`; lint returns 0 errors (web warnings remain non-blocking). |
| `pnpm build` | 2026-04-07 | 2026-04-07 | Passed with warnings | Executed as `corepack pnpm build`; workspace build succeeds, web build reports non-blocking warnings. |
| `pnpm test` | 2026-04-07 | 2026-04-07 | Passed | Executed as `corepack pnpm test`; all workspace tests pass, including health integration suite. |
| `pnpm --filter @stay-ops/web test:e2e` or `pnpm e2e:local` | 2026-04-07 | 2026-04-07 | Passed (`pnpm e2e:local`) | Re-run after admin configuration implementation: 20 passed, 4 skipped in CI-like local pipeline on port `3005`. |

## Readiness Probe Results
Run in staging for final go/no-go decision.

| Probe | Expected | Result | Notes |
|---|---|---|---|
| `GET /api/health/live` | `200` | Verified in integration tests | `apps/web/tests/integration/health/health.api.test.ts` passes. |
| `GET /api/health/ready` | `200` | Verified in integration tests | Deterministic readiness checks now pass in suite. |
| `GET /api/health` | readiness alias behavior | Verified in integration tests | Alias route behavior validated by health test suite. |
| `POST /api/auth/login` + `GET /api/auth/me` | success/session identity | Verified in integration and E2E | Auth integration tests and `e2e:local` run pass. |
| `POST /api/assignments` + `PATCH /api/assignments/[id]/reassign` | success | Verified in integration and E2E | Assignment integration tests and smoke flow in `e2e:local` pass. |
| `GET /api/sync/runs` | `200` with run list shape | Verified in E2E smoke | Covered in `smoke-ops-gate` within `e2e:local`. |
| `GET /api/admin/config/templates` + `GET /api/admin/config/thresholds` | `200` with data list | Verified in integration and E2E | Admin config API integration suite passes and admin E2E smoke persists threshold updates. |

## Rollback Verification
- [x] Rollback steps reviewed against `docs/runbooks/production-deploy.md`.
- [ ] Last known-good deploy artifact identified.
- [x] Migration compatibility/rollback considerations reviewed.
- [x] Post-rollback health/readiness smoke plan confirmed.

## Risk Register Disposition
| Risk ID | Disposition | Approver | Expiry/Review Date | Notes |
|---|---|---|---|---|
| RR-001 | Accepted (non-blocking for MVP) | Engineering | 2026-04-21 | Worker package has no dedicated tests; mitigated by integration/E2E + runtime probes, follow-up required. |
| RR-002 | Mitigated | Engineering | 2026-04-21 | Seed race fixed with advisory lock; local CI-like E2E gate now passes. |
| RR-003 | Accepted (known limitation) | Product + Engineering | 2026-04-21 | Timezone placeholder remains documented and tracked for post-MVP hardening. |
| RR-004 | Mitigated | Engineering | 2026-04-21 | Admin configuration UI/API added with integration + unit + E2E coverage and protected auth routes. |

## Sign-Off
| Role | Name | Decision | Timestamp (UTC) | Notes |
|---|---|---|---|---|
| Engineering | Release Eng (pending name) | Approved | 2026-04-07 | All mandatory local gates passed in this run. |
| Operations | _TBD_ | Pending | _TBD_ | Awaiting deployment window sign-off. |
| Product | _TBD_ | Pending | _TBD_ | Awaiting release authorization. |

## Final Release Decision
- Decision: `Go` (engineering gate), pending final Ops/Product approval
- Reason: Mandatory local command gates pass and readiness/workflow probes are validated through integration + CI-like local E2E evidence.

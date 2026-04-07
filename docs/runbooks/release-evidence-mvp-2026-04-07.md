# MVP Release Evidence - 2026-04-07

## Scope Confirmation
- Scope: MVP through Phase 8.
- Explicitly excluded from runtime readiness: Phase 9 alerts implementation.
- Scope reference checked against `README.md` and `docs/phases/phase-09-alerts-design.md`.

## Command Gate Results
Record actual execution results for required commands.

| Command | Start (UTC) | End (UTC) | Result | Notes |
|---|---|---|---|---|
| `pnpm lint` | 2026-04-07 | 2026-04-07 | Failed | `pnpm` not found in shell PATH; direct recursive lint via `corepack pnpm -r run lint` fails with ESLint errors in `packages/db/scripts/retention-prune.mjs` (`process`/`console` undefined). |
| `pnpm build` | 2026-04-07 | 2026-04-07 | Passed with warnings | Executed as `corepack pnpm -r run build`; workspace build succeeds, web build reports non-blocking warnings. |
| `pnpm test` | 2026-04-07 | 2026-04-07 | Failed | Executed as `corepack pnpm -r run test`; `apps/web/tests/integration/health/health.api.test.ts` has 2 failures (`/api/health` and `/api/health/ready` expected 200, got 503). |
| `pnpm --filter @stay-ops/web test:e2e` or `pnpm e2e:local` | 2026-04-07 | 2026-04-07 | Failed | `corepack pnpm --filter @stay-ops/web test:e2e` fails in e2e reseed path with Prisma `P2003` FK error in `packages/db/prisma/seed-e2e.ts`; 1 failed, 21 skipped. |

## Readiness Probe Results
Run in staging for final go/no-go decision.

| Probe | Expected | Result | Notes |
|---|---|---|---|
| `GET /api/health/live` | `200` | Partial evidence only | Integration tests show liveness route can return success; no staging probe run captured in this evidence pack. |
| `GET /api/health/ready` | `200` | Failed in integration context | Integration test currently returns `503` in local run. |
| `GET /api/health` | readiness alias behavior | Failed in integration context | Integration test currently returns `503` in local run. |
| `POST /api/auth/login` + `GET /api/auth/me` | success/session identity | Not executed in staging probe pass | Covered by integration tests but staging probe evidence is missing. |
| `POST /api/assignments` + `PATCH /api/assignments/[id]/reassign` | success | Not executed in staging probe pass | Covered by integration tests but staging probe evidence is missing. |
| `GET /api/sync/runs` | `200` with run list shape | Not executed in staging probe pass | No staging probe evidence recorded. |

## Rollback Verification
- [ ] Rollback steps reviewed against `docs/runbooks/production-deploy.md`.
- [ ] Last known-good deploy artifact identified.
- [ ] Migration compatibility/rollback considerations reviewed.
- [ ] Post-rollback health/readiness smoke plan confirmed.

## Risk Register Disposition
| Risk ID | Disposition | Approver | Expiry/Review Date | Notes |
|---|---|---|---|---|
| RR-001 | Open | _TBD_ | _TBD_ | Worker runtime test-gap risk remains open. |
| RR-002 | Open | _TBD_ | _TBD_ | E2E reliability/seed coupling risk remains open (observed failure). |
| RR-003 | Open | _TBD_ | _TBD_ | Timezone placeholder risk remains open. |

## Sign-Off
| Role | Name | Decision | Timestamp (UTC) | Notes |
|---|---|---|---|---|
| Engineering |  | _TBD_ | _TBD_ |  |
| Operations |  | _TBD_ | _TBD_ |  |
| Product |  | _TBD_ | _TBD_ |  |

## Final Release Decision
- Decision: `No-Go`
- Reason: Mandatory command gate failed (`lint`, `test`, and `e2e`) and staging readiness probe evidence is incomplete.

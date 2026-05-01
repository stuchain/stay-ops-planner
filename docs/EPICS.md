# Ship-Readiness Epics

## Epic 1: Error Contract And Global Failure UX
**Description:** Create a unified runtime/API failure experience so errors are actionable and traceable via `traceId`.

**Acceptance Criteria**
- All API handlers return `{ code, message, details, traceId }` on errors.
- App-level and route-level fallback UIs are implemented.
- Retry actions are available for safe retryable failures.
- `traceId` is included in response payloads and server logs.

**Test Plan**
- Force route exceptions and verify envelope shape.
- Validate fallback screens render and retry behavior works.
- Confirm `traceId` is stable per request and appears in logs.

### Child Tasks
- Add shared API error helper and status mapping.
- Add request trace ID middleware/helper.
- Add global error boundary and reusable error state components.

## Epic 2: Sentry First (Error Tracking And Releases)
**Description:** Instrument backend and frontend with Sentry and release metadata.

**Acceptance Criteria**
- Sentry is enabled for server and client runtime errors.
- Release tag is attached to all captured events.
- `traceId` and user/session context are attached when available.
- Sensitive fields are redacted.

**Test Plan**
- Trigger synthetic API/UI errors and verify Sentry ingestion.
- Confirm release tagging and context enrichment.
- Verify redaction rules by inspecting sample events.

### Child Tasks
- Add Sentry SDK wiring for web and API layers.
- Add release tagging in runtime/deploy pipeline.
- Add context enrichment and redaction filters.

## Epic 3: Retry And Backoff For Transient Failures
**Description:** Improve resilience for transient DB/sync failures.

**Acceptance Criteria**
- Retry utility supports max attempts, jitter, and timeout budget.
- Reconcile/sync flows use retry logic for transient failures.
- Retry attempts are logged with structured metadata.

**Test Plan**
- Simulate transient failures and verify eventual success.
- Simulate persistent failures and verify capped retries.
- Verify non-transient errors do not retry.

### Child Tasks
- Implement `withRetry` utility.
- Apply retry logic to sync/reconcile paths.
- Add retry metrics and structured retry logs.

## Epic 4: RBAC Enforcement Across Admin And Sync
**Description:** Enforce explicit role checks across all sensitive routes.

**Acceptance Criteria**
- Full route inventory with role policy matrix exists.
- Admin/sync routes enforce explicit role authorization.
- Denied access returns consistent 401/403 error envelope.

**Test Plan**
- Integration matrix coverage for unauthenticated/operator/admin users.
- Route-level regression tests for all protected endpoints.

### Child Tasks
- Build authorization inventory and policy matrix.
- Enforce policy in admin routes.
- Enforce policy in sync routes.
- Add integration tests for authz outcomes.

## Epic 5: Dry-Run Controls For Risky Operations
**Description:** Add safe preview mode for destructive or high-impact operations.

**Acceptance Criteria**
- Reconcile and bulk operations support `dryRun=true`.
- Dry run returns impact summary (counts/entities/warnings).
- Dry run performs zero writes.

**Test Plan**
- Compare DB state before/after dry run to verify no mutations.
- Compare dry-run summary against actual execution output.

### Child Tasks
- Add dry run to reconcile endpoint/service.
- Add dry run to bulk booking/assignment actions.
- Add UI support for dry-run execution and output.

## Epic 6: Idempotency Keys And Mutation Guardrails
**Description:** Prevent duplicate side effects from retries/replays and race conditions.

**Acceptance Criteria**
- Critical mutation endpoints accept idempotency keys.
- Duplicate requests return safe deterministic responses.
- Mutation state transitions are guarded and conflict-safe.

**Test Plan**
- Replay same request/key and verify no duplicate writes.
- Run concurrency tests for conflict paths.

### Child Tasks
- Add idempotency storage/middleware.
- Integrate idempotency in reconcile and assignment mutations.
- Add mutation transition guards and conflict responses.

## Epic 7: Session Hardening And Rate Limiting
**Description:** Harden auth/session security and abuse protection.

**Acceptance Criteria**
- Session TTL/inactivity policy is implemented.
- Cookie security settings are environment-aware.
- Login and sensitive endpoints are rate-limited.

**Test Plan**
- Session expiration/inactivity integration tests.
- Rate-limit burst tests on login/sensitive routes.

### Child Tasks
- Implement session policy (ttl, inactivity, secure cookie flags).
- Add brute-force protection on login.
- Add route-level rate limiting on sensitive operations.

## Epic 8: UI Consistency Pass And Design Tokens
**Description:** Standardize visual language and interaction behavior.

**Acceptance Criteria**
- Shared design tokens exist for colors/radii/spacing/typography.
- Buttons, modals, and feedback components follow one hierarchy.
- Critical screens use consistent copy and spacing patterns.

**Test Plan**
- Visual QA checklist across calendar/bookings/settings.
- Snapshot/storybook checks for core primitives (if available).

### Child Tasks
- Define token source and variable conventions.
- Standardize button hierarchy and modal interactions.
- Apply copy/spacing pass on top workflows.

## Epic 9: Accessibility Remediation
**Description:** Ensure core flows are keyboard- and assistive-tech friendly.

**Acceptance Criteria**
- No critical a11y violations on key flows.
- Focus order/traps and escape behavior are correct.
- ARIA labels and color contrast pass baseline checks.

**Test Plan**
- Automated axe/lighthouse checks for core pages.
- Manual keyboard-only walkthrough for critical journeys.

### Child Tasks
- Run accessibility audit and classify findings.
- Fix modal/focus handling and keyboard interactions.
- Fix contrast and ARIA coverage gaps.

## Epic 10: Test Strategy Upgrade
**Description:** Increase confidence on critical behavior with targeted regression and contract tests.

**Acceptance Criteria**
- Regression coverage for reconcile, cancellation propagation, assignment conflicts.
- API contract tests verify standardized error envelope.
- Smoke e2e covers login -> calendar -> booking detail -> sync warnings.

**Test Plan**
- Run new regression and contract suites in CI.
- Monitor smoke e2e flake rate and enforce threshold.

### Child Tasks
- Add reconcile regression tests.
- Add cancellation propagation tests.
- Add assignment conflict tests.
- Add API error contract tests.
- Add critical smoke e2e scenario.

## Epic 11: CI/CD Quality Gates
**Description:** Enforce correctness and migration safety before merge/deploy.

**Acceptance Criteria**
- PR checks require lint, typecheck, unit, selective integration.
- Migration status and schema drift checks are enforced.
- Post-deploy health checks are automated.

**Test Plan**
- Intentionally failing PR is blocked by required checks.
- Pipeline fails on migration drift mismatch.
- Health checks run and report pass/fail post-deploy.

### Child Tasks
- Configure required PR check workflow.
- Add migration status and schema drift checks.
- Add preview/prod health-check steps.

## Epic 12: Performance And Scalability
**Description:** Optimize hot paths and add operational visibility for background processing.

**Acceptance Criteria**
- Query profiling baseline documented for calendar/sync endpoints.
- Measured index improvements are applied.
- Safe caching strategy added for read-heavy endpoints.
- Retry/dead-letter visibility exists for background jobs.

**Test Plan**
- Before/after latency and explain-plan comparisons.
- Fault injection validates retry/failure observability.

### Child Tasks
- Profile high-frequency queries and identify hotspots.
- Add index migrations based on profiling.
- Add route caching with invalidation strategy.
- Add job reliability dashboards and dead-letter insights.

## Epic 13: Audit And Compliance Completeness
**Description:** Ensure sensitive operations are fully auditable and exportable.

**Acceptance Criteria**
- Sensitive mutations log actor plus before/after snapshots.
- Audit export supports filters, date range, and permission checks.
- Export format is documented and stable.

**Test Plan**
- Integration tests assert audit records for sensitive writes.
- Export endpoint tests verify access control and payload correctness.

### Child Tasks
- Audit coverage gap analysis.
- Add missing before/after snapshot writes.
- Implement audit export endpoint/tooling.

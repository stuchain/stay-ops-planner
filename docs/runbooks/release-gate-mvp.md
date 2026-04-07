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

# Runbook: Conflict Resolution Flood

## Severity
- **SEV-2** if `needs_reassignment` backlog exceeds 20 bookings.
- **SEV-1** if unresolved conflicts block same-day check-ins.

## Detection
- `/app/dashboard` unresolved conflict bucket growth.
- Calendar markers and booking flags show conflict spikes.

## Triage
1. Identify top affected rooms/date windows.
2. Confirm whether conflicts come from import errors, manual block overlap, or assignment races.
3. Prioritize upcoming check-ins (next 48 hours).

## Mitigation
1. Resolve high-priority bookings through unassigned queue and suggestions.
2. Remove stale manual blocks when safe.
3. Re-run sync reconcile to ensure latest provider state.

## Rollback
- If conflict wave follows deployment, roll back latest release and resume with previous stable build.

## Verification
- `needs_reassignment` backlog returns to acceptable threshold.
- No same-day check-in stays remain unresolved.
- Audit history records all manual conflict operations.

## Communication template
- Incident: Conflict backlog surge.
- Impact: Allocation operations slowed.
- Action: Prioritized queue triage and room-level conflict resolution.
- ETA to stability: <time>.

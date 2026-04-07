# Alerts Event Catalog

## Purpose
Define canonical alert events, ownership, thresholds, and routing context for future WhatsApp/SMS notifications.

## Event Definitions

### `SYNC_RUN_FAILED`
- **Owner**: Integrations / Operations
- **Trigger**: Latest sync run ends with status `failed`.
- **Threshold**: Trigger immediately on failed run completion.
- **Severity**: `high`
- **Suppression**: 1 hour per integration source.
- **Primary context keys**: `syncRunId`, `sourceSystem`, `errorCode`.

### `UNASSIGNED_BACKLOG_THRESHOLD_REACHED`
- **Owner**: Allocation / Operations
- **Trigger**: Number of unassigned bookings remains above configured threshold for 24 hours.
- **Threshold**: `unassignedCount > backlogThreshold` for continuous 24h window.
- **Severity**: `medium`
- **Suppression**: 24 hours per property/portfolio scope.
- **Primary context keys**: `portfolioId`, `unassignedCount`, `backlogThreshold`.

### `CLEANING_OVERDUE`
- **Owner**: Cleaning / Operations
- **Trigger**: Cleaning task is still not complete after planned end timestamp.
- **Threshold**: `now > plannedEndAt` and task status not terminal.
- **Severity**: `high`
- **Suppression**: 4 hours per cleaning task.
- **Primary context keys**: `taskId`, `roomCode`, `plannedEndAt`, `currentStatus`.

### `CONFLICT_RESOLUTION_REQUIRED`
- **Owner**: Allocation / Operations
- **Trigger**: Assignment conflict remains unresolved beyond response SLA.
- **Threshold**: Conflict state active longer than configured SLA duration.
- **Severity**: `high`
- **Suppression**: 2 hours per conflict record.
- **Primary context keys**: `conflictId`, `assignmentId`, `slaMinutes`.

## Routing and Escalation Guidance
- Route `high` severity events to on-call operations recipients immediately.
- Route `medium` severity events to shift lead recipients first, then escalate if unresolved.
- Event ownership above defines responsible team for remediation and runbook updates.

# Alert Payload Contracts

## Required Fields
All alert payloads must include:
- `eventType`
- `idempotencyKey`
- `occurredAt` (ISO-8601 UTC timestamp)
- `severity` (`low` | `medium` | `high`)
- `context` (event-specific object)

## Canonical Envelope
```json
{
  "eventType": "CLEANING_OVERDUE",
  "idempotencyKey": "evt_01J0ABCDEFXYZ",
  "occurredAt": "2026-07-12T09:00:00Z",
  "severity": "high",
  "context": {
    "taskId": "ct_123",
    "roomCode": "R2"
  }
}
```

## Event Examples

### `SYNC_RUN_FAILED`
```json
{
  "eventType": "SYNC_RUN_FAILED",
  "idempotencyKey": "sync_fail_2026-07-12_hosthub_run_987",
  "occurredAt": "2026-07-12T08:10:00Z",
  "severity": "high",
  "context": {
    "syncRunId": "sr_987",
    "sourceSystem": "hosthub",
    "errorCode": "TIMEOUT"
  }
}
```

### `UNASSIGNED_BACKLOG_THRESHOLD_REACHED`
```json
{
  "eventType": "UNASSIGNED_BACKLOG_THRESHOLD_REACHED",
  "idempotencyKey": "backlog_alert_portfolio_berlin_2026-07-12",
  "occurredAt": "2026-07-12T06:00:00Z",
  "severity": "medium",
  "context": {
    "portfolioId": "pf_berlin",
    "unassignedCount": 14,
    "backlogThreshold": 10,
    "windowHours": 24
  }
}
```

### `CLEANING_OVERDUE`
```json
{
  "eventType": "CLEANING_OVERDUE",
  "idempotencyKey": "cleaning_overdue_task_ct_123_2026-07-12T09",
  "occurredAt": "2026-07-12T09:00:00Z",
  "severity": "high",
  "context": {
    "taskId": "ct_123",
    "roomCode": "R2",
    "plannedEndAt": "2026-07-12T08:30:00Z",
    "currentStatus": "IN_PROGRESS"
  }
}
```

### `CONFLICT_RESOLUTION_REQUIRED`
```json
{
  "eventType": "CONFLICT_RESOLUTION_REQUIRED",
  "idempotencyKey": "conflict_required_cf_456_2026-07-12T07",
  "occurredAt": "2026-07-12T07:00:00Z",
  "severity": "high",
  "context": {
    "conflictId": "cf_456",
    "assignmentId": "as_912",
    "slaMinutes": 60
  }
}
```

## Contract Notes
- `context` shape is event-specific and versioned by event type.
- Consumers must ignore unknown `context` fields for forward compatibility.
- Producers must keep keys stable to preserve template bindings.

# Audit trail and NDJSON export

## Coverage inventory

Sensitive mutations should call `writeAuditSnapshot` (from `@stay-ops/audit`) inside the same database transaction as the write when possible. Current coverage:

| Area | Actions (examples) | Notes |
|------|---------------------|--------|
| Assignments | `assignment.assign`, `assignment.reassign`, `assignment.unassign`, bulk variants | Via allocation service |
| Manual blocks | `manual_block.create`, `manual_block.update`, `manual_block.delete` | Blocks service |
| Bookings | `booking.update`, `booking.cancelled_bulk` | PATCH uses `booking.update`; bulk cancel audited per booking |
| Cancellation side effects | `assignment.released_on_cancel`, `cleaning_task.cancelled_on_booking_cancel` | Sync package |
| Cleaning | Task status transitions, scheduling helpers | State machine / taskSchedule |
| Admin config | Threshold and alert template upserts | `admin-configuration/service` |
| Hosthub admin | Reset cursor, full resync, etc. | Admin API routes |
| Sync pipeline | Reservation apply / revalidate | `packages/sync` |
| Auth | Login success/failure | `api/auth/login` |
| Excel | `excel_rental_config.update`, `excel_listing.rental_index`, `excel_ledger_entry.create_manual`, `excel_ledger_entry.create_booking`, `excel_ledger_entry.ensure_booking`, `excel_ledger_entry.update_overrides`, `excel_ledger_entry.delete_manual`, `excel_ledger_entry.clear_overrides` | `modules/excel/excelAuditMutations` |
| Rooms | `room_calendar_sort.reorder` | Single snapshot for full active-room order |

Extend this table when adding new mutation paths.

## NDJSON export (`GET /api/audit/export`)

### Compatibility

- **`schemaVersion`** (integer in the header line): bump only when a breaking change is made to event line shape or header fields (document the change in this file).
- Current **`schemaVersion`: `1`**.

### MIME and file

- **Content-Type:** `application/x-ndjson`
- **Content-Disposition:** `attachment` with a filename prefix `audit-export-` and `.ndjson` suffix.

### Line grammar

1. **First line:** a single JSON object with `type: "audit_export_header"`.
2. **Following lines:** one JSON object per line, each an **audit event** with the same shape as items in `GET /api/audit/events` (`id`, `actorUserId`, `action`, `entityType`, `entityId`, `beforeJson`, `afterJson`, `metaJson`, `createdAt`, `redacted`).

Newlines inside JSON are not allowed; each line is exactly one `JSON.stringify` result.

### Header object (schema v1)

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"audit_export_header"` |
| `schemaVersion` | number | `1` |
| `exportedAt` | string | ISO-8601 UTC timestamp |
| `filters` | object | Echo of applied filters: `entityType`, `bookingId`, `roomId`, `actorUserId`, `from`, `to` (dates as `YYYY-MM-DD`) |

### Query parameters

Same as `GET /api/audit/events`: `entityType`, `bookingId`, `roomId`, `actorUserId`, `from`, `to` (optional `from`/`to` default to last 7 days / today UTC). Optional `format=ndjson` (default).

### Authorization

Requires an authenticated **operator** or **admin** session (same as `/api/audit/events`).

### Limits

| Limit | Value |
|-------|--------|
| Maximum date span (`to` − `from`) | 366 days |
| Maximum events per export | 50,000 |

Exceeding limits returns **422** with the standard API error JSON (`code`, `message`, `details`, `traceId`).

### Room calendar sort snapshot shape

Events with action `room_calendar_sort.reorder` use:

- `entityType`: `room_calendar_sort`
- `entityId`: `all_active_rooms`
- `before` / `after`: `{ "roomIds": string[] }` — room IDs ordered by ascending `calendarSortIndex` (index `0` is leftmost in the UI).

This shape is stable for schema v1.

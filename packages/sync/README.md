# @stay-ops/sync

Hosthub integration: HTTP client, normalization, and job processors. DTOs are stubs until the official OpenAPI is vendored; confirm field names against current Hosthub docs before production use.

**Security:** Never log `Authorization` or full API tokens. Booking payloads may contain PII—treat logs and stored `rawPayload` as internal-only.

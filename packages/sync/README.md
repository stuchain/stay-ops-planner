# @stay-ops/sync

Hosthub integration: HTTP client, normalization, and job processors.

**Official API reference:** [https://www.hosthub.com/docs/api/](https://www.hosthub.com/docs/api/)

**Repo notes:** [docs/vendor/hosthub-api.md](../../docs/vendor/hosthub-api.md) — how our env vars map to the docs, and what to re-check when Hosthub ships schema updates.

The HTTP client default base URL is `https://app.hosthub.com/api/2019-03-01` (`HOSTHUB_API_BASE`). List responses are parsed leniently (`data` / `reservations` / `items` / …; snake_case or camelCase fields) so small doc drift does not break sync; tighten DTOs when you vendor OpenAPI into `docs/vendor/`.

**Security:** Never log `Authorization` or full API tokens. Booking payloads may contain PII—treat logs and stored `rawPayload` as internal-only.

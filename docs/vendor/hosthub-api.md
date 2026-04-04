# Hosthub API — integration reference

**Authoritative documentation:** [https://www.hosthub.com/docs/api/](https://www.hosthub.com/docs/api/)

Stay Ops Planner targets the versioned base URL **`https://app.hosthub.com/api/2019-03-01`** (configurable via `HOSTHUB_API_BASE`). Confirm the exact base path, authentication scheme, and resource names in the live docs above before production traffic.

## What to verify in Hosthub docs

| Area | This repo (defaults) | Action |
|------|----------------------|--------|
| Base URL / API version | `HOSTHUB_API_BASE` | Match the version string shown in Hosthub’s API overview |
| List endpoint | `HOSTHUB_API_RESERVATIONS_PATH` (default `/reservations`) | Confirm path (e.g. reservations vs bookings) in the reference |
| Query parameters | `cursor`, `updated_since` on list GET | Match pagination and filter param names from docs |
| Auth | `Authorization: Bearer <token>` (`HOSTHUB_API_TOKEN`) | Match Hosthub authentication section |
| Webhooks | `WEBHOOK_SECRET`, optional `HOSTHUB_WEBHOOK_SIGNATURE_HEADER` | Match webhook signing algorithm and header name from docs |

## Vendoring OpenAPI

If Hosthub provides an OpenAPI/Swagger export in the docs portal, download it into `docs/vendor/` (e.g. `hosthub-openapi.json`) and update `packages/sync` DTOs to match. Until then, `packages/sync` uses a **lenient** normalizer (camelCase and snake_case aliases) so minor naming differences do not break ingest.

## Support

Hosthub’s feature page notes partner support for integrations: [Hosthub Open API](https://hosthub.com/features/hosthub-api).

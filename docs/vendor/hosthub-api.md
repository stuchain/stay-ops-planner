# Hosthub API — vendor reference

**Live docs:** [https://www.hosthub.com/docs/api/](https://www.hosthub.com/docs/api/)

**Source of this file:** Hosthub Swagger/OpenAPI export (`swagger: "2.0"`, API **1.6.4**). Use it for implementation and reviews; confirm behavior against the portal if Hosthub ships updates.

---

## 1. Quick reference

| Item | Value |
|------|--------|
| Host | `app.hosthub.com` |
| Scheme | `https` |
| Base path | `/api/2019-03-01` |
| Full base URL | `https://app.hosthub.com/api/2019-03-01` |
| Content type | `application/json` |
| Auth | API key in header `Authorization` (see below) |

**Versioning:** The `2019-03-01` segment is kept because no backward-breaking API version has replaced it; future breaking changes are expected under a new path.

---

## 2. Authentication

| Field | Value |
|--------|--------|
| Type | `apiKey` |
| In | Header |
| Name | `Authorization` |

Spec text: obtain the key from Hosthub (**Settings**), send it on **every** request.

```http
Authorization: YOUR_HOSTHUB_API_KEY
```

```bash
curl -H "Authorization: YOUR_HOSTHUB_API_KEY" \
  "https://app.hosthub.com/api/2019-03-01/users"
```

*(Implementation note: this is an API key in the `Authorization` header, not OAuth2 Bearer tokens, though some clients treat the string similarly.)*

---

## 3. Resource model (concepts)

| Concept | Role |
|---------|------|
| **User** | Hosthub account |
| **Rental** | Property / listing |
| **Channel** | External connection for a rental (e.g. Airbnb, Booking.com) |
| **Rate plan** | Pricing plan for a rental |
| **Rate mandate** | Command-like update to specific dates on a rate plan |
| **Calendar event** | Occupancy: **Booking** or **Hold** (+ metadata) |
| **Note (calendar event)** | Notes on an event |
| **CalendarEventGrTax** | Greek tax breakdown for a booking event |

---

## 4. Endpoint index

All paths are relative to `https://app.hosthub.com/api/2019-03-01`.

### Users

| Method | Path |
|--------|------|
| `GET` | `/users` |
| `GET` | `/users/{userId}` |

### Rentals

| Method | Path |
|--------|------|
| `GET` | `/rentals` |
| `GET` | `/rentals/{rentalId}` |
| `GET` | `/rentals/{rentalId}/channels` |
| `GET` | `/rentals/{rentalId}/rate-plans` |
| `GET` | `/rentals/{rentalId}/calendar-events` |
| `POST` | `/rentals/{rentalId}/calendar-events` |

### Rate plans & mandates

| Method | Path |
|--------|------|
| `GET` | `/rate-plans/{encodedId}` |
| `GET` | `/rate-plans/{encodedId}/rates` |
| `POST` | `/rate-plans/{encodedId}/rate-mandates` |
| `GET` | `/rate-mandates/{encodedId}` |

### Calendar events (global + per-event)

| Method | Path |
|--------|------|
| `GET` | `/calendar-events` |
| `POST` | `/calendar-events/{calendarEventKey}` |
| `DELETE` | `/calendar-events/{calendarEventId}` |
| `GET` | `/calendar-events/{calendarEventId}/calendar-event-gr-taxes` |
| `GET` | `/calendar-events/{calendarEventId}/notes` |

---

## 5. Users

### List — `GET /users`

Returns users visible to the key (often a single user).

**200** → `UsersList`:

```json
{
  "object": "User",
  "data": [ /* User */ ]
}
```

**User (fields):** `id`, `object` (`User`), `name`, `email`, `url`

### Get — `GET /users/{userId}`

**200** → `User`

---

## 6. Rentals

### List — `GET /rentals`

**200** → `RentalsList`:

```json
{
  "object": "Rental",
  "data": [ /* Rental */ ]
}
```

### Get — `GET /rentals/{rentalId}`

**Rental (fields include):** `id`, `object` (`Rental`), `name`, `postal_code`, `latitude`, `longitude`, `url`

**Spec inconsistency:** some examples use `/rental/...` in URLs; documented list path is `/rentals`. Treat **`/rentals`** as canonical unless Hosthub confirms otherwise.

---

## 7. Channels

### List for rental — `GET /rentals/{rentalId}/channels`

**200** → `ChannelList`:

```json
{
  "object": "Channel",
  "data": [ /* Channel */ ],
  "navigation": { "next": "...", "previous": "..." }
}
```

**Channel:** `id`, `name`, `base_channel` (`id`, `name`)

**Pagination:** use `navigation.next` / `navigation.previous` **as full URLs** (they carry `cursor_gt` / `cursor_lt`). Do not hand-roll query strings.

---

## 8. Rate plans & daily rates

### List plans for rental — `GET /rentals/{rentalId}/rate-plans`

**200** → `{ "object": "RatePlan", "data": [ ... ] }`

**RatePlan:** `object`, `id`, `name`, `default`, `status` (`active` | `inactive`), `url`

### Get plan — `GET /rate-plans/{encodedId}`

`encodedId` is the rate plan id (not `rentalId`).

### Daily rates — `GET /rate-plans/{encodedId}/rates`

**200** → `{ "object": "RentalDailyRate", "data": [ ... ] }`

**RentalDailyRate (among others):** `date`, `amount`, `block_arrival`, `block_departure`, `is_available`, `type`, `rate_type` (`base` | `custom`), LOS fields, per-person extras.

**Money:** `{ "cents": 12245, "currency": "USD" }` — see [§12 Money](#12-money).

**Note:** daily price may be net or gross per account settings; do not assume payout semantics.

---

## 9. Rate mandates

Commands that apply pricing / stay rules to specific dates (up to **730 days** ahead per mandate day).

### Create — `POST /rate-plans/{encodedId}/rate-mandates`

**Body:** array of **MandateDay** (`date`, `price`, optional LOS / block flags, etc.)

**201** → `RateMandate` (`id`, `url`, `status`: `pending` | `in progress` | `executed`, `days`, …)  
**400** → `Error`

### Get — `GET /rate-mandates/{encodedId}`

**200** → `RateMandate`

---

## 10. Calendar events

Central resource for **bookings** and **holds** (occupancy, guest, money, ops fields).

### 10.1 List (all accessible rentals) — `GET /calendar-events`

Default: only **visible** events (not cancelled/deleted).

**Query parameters**

| Param | Meaning |
|--------|---------|
| `updated_gt`, `updated_gte` | Unix timestamp (integer) |
| `created_gt`, `created_gte` | Unix timestamp (integer) |
| `is_visible` | `all` \| `true` \| `false` (default `true`) |

**200** → `CalendarEventList` with `data` and **`navigation.next` / `navigation.previous`** (same cursor URL pattern as channels).

Use this for **incremental sync** (created/updated filters + cursor traversal).

### 10.2 List for one rental — `GET /rentals/{rentalId}/calendar-events`

Same query parameters as global list.

### 10.3 Create — `POST /rentals/{rentalId}/calendar-events`

**Required:** `type`, `date_from`, `date_to`

**`type`:** `Booking` | `Hold`

**Date rules (create & update):**

- Each date ≤ **730 days** from today  
- Span `date_from` → `date_to` ≤ **365 days**

**Booking-only (examples):** `check_in_time`, `check_out_time`, `reservation_id`, guest fields, `notes`, money fields, `source_id`, etc.  
**Hold-only (examples):** `hold_reason` (`housekeeping` \| `repairs` \| `personal_use` \| `other`), `title`

**`identification_type`:** `naid` | `pano` | `vatn`

**201** → `CalendarEvent`  
**400** → `Error`

### 10.4 Update — `POST /calendar-events/{calendarEventKey}`

Partial updates for Booking or Hold. If you change **`date_from`**, you must also send **`date_to`**, and vice versa. Same date window rules as create.

**Naming caveat:** this route uses **`calendarEventKey`**; delete / notes / GR taxes use **`calendarEventId`**. Treat each path as specified.

**200** → `CalendarEvent`  
**400** → `Error`

### 10.5 Delete — `DELETE /calendar-events/{calendarEventId}`

**Not a hard delete:** `is_visible` becomes false, event stops blocking calendar, **cannot** be made visible again.

**204** — success  
**404** — not found / no access

### 10.6 Greek taxes — `GET /calendar-events/{calendarEventId}/calendar-event-gr-taxes`

**200** → `CalendarEventGrTax` (monetary fields use **Money**; see spec for `total_booking_value`, VAT, `aade_value`, etc.)

### 10.7 Notes — `GET /calendar-events/{calendarEventId}/notes`

**200** → `{ "object": "NoteCalendarEvent", "data": [ ... ] }`

**NoteCalendarEvent:** `id`, `object`, `created`, `updated`, `status` (`active` | `deleted`), `content`, `created_by` (UserShort), `calendar_event` (CalendarEventShort)

---

## 11. CalendarEvent object (summary)

Full responses include many fields. Grouped for scanning:

| Group | Examples |
|--------|-----------|
| Core | `id`, `object`, `type`, `master_calendar_event_id`, `created`, `updated`, `date_from`, `date_to`, `nights`, `rental`, `is_visible`, `title`, … |
| Guest / stay | `guest_name`, `guest_adults`, `guest_children`, contact/address fields, `identification_*`, `meal_plan`, … |
| Money | `booking_value`, fees, `total_payout`, `taxes`, `guest_paid`, … |
| Meta | `notes`, `reservation_id`, `source`, `hold_reason`, `url`, … |

**Embedded examples (shape):**

```json
"rental": {
  "id": "oku721",
  "object": "Rental",
  "name": "Ampelos Villa",
  "url": "/api/2019-03-01/rental/oku721"
}
```

```json
"source": {
  "id": "VAZPkQNRlE",
  "name": "Booking.com",
  "channel_type_code": "booking.com"
}
```

### Identity and semantics (critical)

| Topic | Detail |
|--------|--------|
| **`reservation_id` not unique** | Same id can exist on different channels (e.g. two “999”s). **Canonical key = Hosthub `id`** on the calendar event. |
| **`master_calendar_event_id`** | Parent/child links (e.g. whole-house vs room splits). |
| **`date_to`** | Day the stay **ends** / unit becomes bookable again (checkout-style boundary in the spec). |

---

## 12. Money

```json
{ "cents": 12245, "currency": "USD" }
```

- `cents` = minor units (100 cents = 1 unit)  
- `currency` = ISO 4217  

Reused across booking fields, daily rates, Greek tax objects, etc.

---

## 13. Pagination

**Documented cursor pagination** (via `navigation.next` / `navigation.previous`):

- `ChannelList`
- `CalendarEventList`

**Not documented in spec as paginated** (do not assume unpaged forever):

- `UsersList`, `RentalsList`, rate plan lists

**Rule:** follow **`navigation`** URLs verbatim when present.

---

## 14. Errors

Minimal shape:

```json
{ "errors": [] }
```

**Typical status codes in spec**

| Code | Context |
|------|---------|
| 400 | Create/update calendar event, create rate mandate |
| 404 | Delete calendar event |

Do not assume rich typed errors beyond what you observe in production.

---

## 15. Business rules (checklist)

1. Calendar create/update: dates ≤ **730** days out; span ≤ **365** days.  
2. Update: change **`date_from`** iff you also send **`date_to`**, and vice versa.  
3. **Hold** vs **Booking**: financial fields vs hold reason/title.  
4. **Delete** = irreversible hide (`is_visible = false`).  
5. Prefer **Hosthub event `id`** over `reservation_id` as stable identity.  
6. Rate mandate days: not beyond **730** days from today.

---

## 16. Stay Ops Planner ↔ Hosthub (this repo)

`@stay-ops/sync` is aligned with this document for polling and normalization:

| Topic | Hosthub spec | `@stay-ops/sync` behavior |
|--------|----------------|---------------------------|
| List “bookings” | **`GET /calendar-events`**, `updated_gte` / `updated_gt` (Unix), **`navigation.next`** URLs | Default list path **`/calendar-events`**; first page sends **`updated_gte`** when a watermark exists in `sync_runs.cursor`; follows **`navigation.next`** verbatim |
| Auth header | `Authorization: <API key>` | Sends the API key in **`Authorization`** with **no** `Bearer` prefix |
| Stable external id | Calendar event **`id`** | Normalizer prefers event **`id`** for `reservationId` → Prisma **`external_booking_id`**; **Hold** rows are skipped; **`date_from` / `date_to`**, nested **`rental.id`**, **`source`** for channel hint |
| Override path | Per-tenant or legacy URL | Optional env **`HOSTHUB_API_RESERVATIONS_PATH`** replaces the list path segment after `HOSTHUB_API_BASE` |

Webhook ingestion accepts the same calendar-event-shaped JSON (including nested **`calendar_event`** / **`calendarEvent`**) via `extractHosthubReservationDto`.

---

## 17. cURL examples

**List rentals**

```bash
curl -H "Authorization: YOUR_HOSTHUB_API_KEY" \
  "https://app.hosthub.com/api/2019-03-01/rentals"
```

**Channels for rental**

```bash
curl -H "Authorization: YOUR_HOSTHUB_API_KEY" \
  "https://app.hosthub.com/api/2019-03-01/rentals/RENTAL_ID/channels"
```

**Calendar events updated since (Unix `updated_gte`)**

```bash
curl -H "Authorization: YOUR_HOSTHUB_API_KEY" \
  "https://app.hosthub.com/api/2019-03-01/calendar-events?updated_gte=1712345678"
```

**Create booking**

```bash
curl -X POST \
  -H "Authorization: YOUR_HOSTHUB_API_KEY" \
  -H "Content-Type: application/json" \
  "https://app.hosthub.com/api/2019-03-01/rentals/RENTAL_ID/calendar-events" \
  -d '{
    "type": "Booking",
    "date_from": "2026-06-10",
    "date_to": "2026-06-14",
    "guest_name": "John Doe",
    "guest_email": "john@example.com",
    "guest_adults": 2,
    "booking_value": { "cents": 55000, "currency": "EUR" }
  }'
```

**Update event**

```bash
curl -X POST \
  -H "Authorization: YOUR_HOSTHUB_API_KEY" \
  -H "Content-Type: application/json" \
  "https://app.hosthub.com/api/2019-03-01/calendar-events/CALENDAR_EVENT_KEY" \
  -d '{"guest_name": "Updated Guest Name", "notes": "Late arrival expected"}'
```

**Delete event**

```bash
curl -X DELETE \
  -H "Authorization: YOUR_HOSTHUB_API_KEY" \
  "https://app.hosthub.com/api/2019-03-01/calendar-events/CALENDAR_EVENT_ID"
```

**Greek taxes**

```bash
curl -H "Authorization: YOUR_HOSTHUB_API_KEY" \
  "https://app.hosthub.com/api/2019-03-01/calendar-events/CALENDAR_EVENT_ID/calendar-event-gr-taxes"
```

**Rate mandate**

```bash
curl -X POST \
  -H "Authorization: YOUR_HOSTHUB_API_KEY" \
  -H "Content-Type: application/json" \
  "https://app.hosthub.com/api/2019-03-01/rate-plans/RATE_PLAN_ID/rate-mandates" \
  -d '[{
    "date": "2026-07-01",
    "price": { "cents": 18000, "currency": "EUR" },
    "minimum_length_of_stay": 2,
    "maximum_length_of_stay": 7,
    "block_arrival": false,
    "block_departure": false
  }]'
```

---

## 18. Spec strengths & caveats

**Strengths:** simple API-key auth, rental-centric model, calendar events as bookings + holds, rate mandates for date-scoped pricing, cursor pagination on large lists, rich booking metadata, GR tax helper for Greece.

**Caveats:** `reservation_id` not globally unique; **`calendarEventKey` vs `calendarEventId`**; singular `/rental` vs plural `/rentals` in some examples; minimal error schema; pagination only explicitly defined for channels + calendar event lists.

---

## 19. Integration recommendations

1. Treat **calendar event** as the primary occupancy primitive (not a separate “reservations only” model).  
2. Use **Hosthub `id`** as canonical event identity in your DB.  
3. Model delete as **permanent deactivation** (`is_visible`).  
4. For channels and calendar events, **only** follow `navigation.next` / `previous`.  
5. Separate **rate plan configuration** from **rate mandate** commands.  
6. Prefer **PMS / dashboard / pricing / occupancy sync** use cases; validate every path against [Hosthub API docs](https://www.hosthub.com/docs/api/) before go-live.

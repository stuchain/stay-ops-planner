# Hosthub fixtures

These files are **synthetic**. They were written by hand from the shapes in
`src/hosthub/types.dto.ts` and `src/hosthub/normalize.ts`, the calendar-event payloads used in the
existing tests, and the `calendar-events/{id}/notes` and `calendar-event-gr-taxes` client methods.
No Hosthub API access was available. All names, emails, phone numbers and ids are fake.

They must be replaced by real recorded responses (with personal data scrubbed) once API access
is available. Until then they stay valid only because `src/hosthub/fixtures.test.ts` runs every
calendar-event fixture through `normalizeHosthubReservationRecord` and checks the notes and
GR-taxes responses for the fields the app reads.

| File | Covers |
| --- | --- |
| `new-booking.json` | New direct booking |
| `date-change.json` | Same event id as `new-booking.json`, later `updated`, new dates and amounts |
| `cancellation.json` | Same event id, `status: cancelled`, `is_visible: false`, `cancelled_at` |
| `airbnb.json` | Airbnb booking with ISO date-times and first/last guest name |
| `booking-com.json` | Booking.com booking with taxes and special requests |
| `direct.json` | Direct booking with status `accepted` and no channel reservation id |
| `hold.json` | `type: Hold` owner/maintenance row (the normaliser skips it) |
| `notes-response.json` | Response of `GET /calendar-events/{id}/notes` |
| `gr-taxes-response.json` | Response of `GET /calendar-events/{id}/calendar-event-gr-taxes` |

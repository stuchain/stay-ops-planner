# Phase 6 - Month Calendar and Full Mobile Allocation UX

## Critical invariants
- UI never bypasses server conflict rules.
- Month view supports drag between room lanes only (no resize in v1).
- Mobile can complete assignment and cleaning updates.

## Dependency map
- Depends on Phase 4 and 5 APIs.

## Alignment with existing app (read before implementing)

**Session middleware** ([`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts)) protects only:

- `/api/*` (except the explicit public allowlist: health, login POST, Hosthub webhook), and  
- `/app/*` (browser “app shell”).

All other paths (e.g. `/`, `/calendar` at repo root) are **not** session-gated by that matcher.

**Canonical Phase 6 routes (normative)**

| User-facing URL | Purpose |
|-----------------|--------|
| `/login` | Email/password form; `POST /api/auth/login`; redirect to `?next=` (add this page in Phase 6 if not present yet). |
| `/app/calendar` | Month calendar + allocation UX. |
| `/app/cleaning` | Cleaning board. |

**Filesystem (Next.js App Router)** — use a real `app` segment so URLs start with `/app/`:

- Calendar shell: `apps/web/src/app/app/calendar/page.tsx` → `/app/calendar`  
- Cleaning shell: `apps/web/src/app/app/cleaning/page.tsx` → `/app/cleaning`  
- Login: `apps/web/src/app/login/page.tsx` → `/login`

Do **not** rely on a route group alone (e.g. `app/(something)/calendar/page.tsx`) unless that group still includes an `app` URL segment; `(group)` does not appear in the URL and would place the calendar at `/calendar`, which middleware does **not** treat as protected.

## Maps to product requirements

- **FP-4, FP-5, FP-13:** month calendar, drag-and-drop, mobile interaction commits.
- **FP-2, FP-16:** unassigned drawer and one-tap assign.
- **FP-7:** cleaning board UI.
- **FP-8, FP-9:** room lanes and **maintenance block** create/edit/delete UI (`feat: add maintenance block create edit and delete UI...`) wired to Phase 4 `/api/blocks*`.

## Commit execution spec

| Commit message | Purpose | Implementation detail | Contracts introduced/changed | Tests required | Definition of done | Risk notes | Traceability |
|---|---|---|---|---|---|---|---|
| `feat: implement month calendar api aggregating room lanes occupancy and conflict markers` | Feed calendar UI | Build `GET /api/calendar/month?month=YYYY-MM` returning `rooms`, unified `items` (bookings + blocks), `markers`, `timezone` | Normative JSON in this doc (items + markers) | Integration tests for month boundaries and sparse data | Endpoint returns deterministic sorted data; empty month → `items: []` | Month timezone boundary bugs; use `APP_TIMEZONE` consistently | `/api/calendar/month`, `modules/calendar` |
| `feat: build month view room-lane interface with draggable booking cards` | Render operations board | Build month grid and room lanes with draggable cards and visible state badges; add `/login` if missing | Frontend view model contract from calendar API | Component tests for rendering lanes/bookings | UI renders all rooms, cards, blocks, and statuses | Performance risk with dense months; virtualize or memoize row rendering | `/app/calendar`, `app/app/calendar/page.tsx`, `app/login/page.tsx`, `modules/calendar/*` |
| `feat: add maintenance block create edit and delete UI wired to blocks api` | Operational maintenance planning | Add modal or side panel to create/edit/delete blocks; call Phase 4 `/api/blocks*`; refresh month data on success | Block form contract: room, date range, optional label/reason | Component tests + mocked API for happy path and overlap error | Operator can manage blocks without SQL; errors surface server messages | Wrong timezone for date pickers; reuse calendar month timezone helper | `modules/blocks/ui`, `/api/blocks*` |
| `feat: add drag-drop between rooms with optimistic update and rollback on server reject` | Fast assignment flow | Wire DnD action to assignment API, local optimistic update, rollback on conflict response | Client mutation contract for conflict error payload | UI integration tests for success/failure rollback | Drag success persists; conflict returns visible error and rollback | State desync risk; refetch month data after mutation settle | calendar DnD handlers + assignment API |
| `feat: add mobile-first interaction model for drag assign and quick booking actions` | Ensure field usability | Add touch-friendly gestures and fallback quick actions for small screens | Mobile interaction contract for same backend routes | E2E mobile viewport tests | Operator can assign/reassign and open booking actions on mobile | Touch DnD instability; provide action-sheet fallback | responsive calendar components |
| `feat: add unassigned queue drawer with one-tap assign and conflict explanation` | Resolve backlog quickly | Implement unassigned drawer linked to suggestions/conflict summaries and assign CTA | UI contract for unassigned list items and conflict messages | Component + integration tests for drawer actions | One-tap assign works and shows server conflict reasons | Queue stale data risk; refresh queue after assignment events | `modules/bookings/ui/unassigned` |
| `feat: build cleaning board ui for assignee and day-based operational execution` | Close daily operations loop | Create cleaning board filters (date/assignee/status) and status actions | Cleaning board query/mutation view model contract | UI tests for filter and transition actions | Board supports todo/in_progress/done operations | Inconsistent status transitions; enforce service-level errors in UI | `/app/cleaning`, `app/app/cleaning/page.tsx`, `modules/cleaning/*`, `/api/cleaning/*` |
| `test: add e2e tests for desktop and mobile allocation and cleaning operations` | Validate end-user workflow | Build E2E journeys for desktop and mobile | E2E contract for critical paths | See **§6.8 / E2E vs product behavior** (queue assign, PATCH conflict, blocks, mobile quick assign, cleaning) | Both viewport suites pass in CI (`.github/workflows/e2e.yml`) | Prefer stable `data-testid` over drag-only assertions in automation | `apps/web/tests/e2e/*.spec.ts` |

## Phase exit criteria
- Operators can perform core allocation and cleaning operations on desktop and mobile.

## E2E automation vs product behavior

Playwright targets **stable** flows and the **same HTTP mutations** the UI uses. **Desktop drag-and-drop** remains the primary operator affordance in [`apps/web/src/modules/calendar/CalendarClient.tsx`](../../apps/web/src/modules/calendar/CalendarClient.tsx) (optimistic lane move, `POST /api/assignments` / `PATCH /api/assignments/:id/reassign`, rollback + `.ops-toast` on failure). **`dragTo` is unreliable with dnd-kit in headless CI**, so automated coverage uses:

- **Desktop assign:** Unassigned queue → `POST /api/assignments` (identical to dropping on a room lane).
- **Allocation conflict:** After a seeded overlap setup, in-page authenticated `PATCH .../reassign` expecting `409` + `CONFLICT_ASSIGNMENT` (same call the drag path makes on an invalid drop).

**Traceability:** [`apps/web/tests/e2e/calendar-allocation.spec.ts`](../../apps/web/tests/e2e/calendar-allocation.spec.ts), [`apps/web/tests/e2e/auth-and-shell.spec.ts`](../../apps/web/tests/e2e/auth-and-shell.spec.ts), [`apps/web/tests/e2e/maintenance-block.spec.ts`](../../apps/web/tests/e2e/maintenance-block.spec.ts), [`apps/web/tests/e2e/mobile-quick-assign.spec.ts`](../../apps/web/tests/e2e/mobile-quick-assign.spec.ts), [`apps/web/tests/e2e/cleaning-board.spec.ts`](../../apps/web/tests/e2e/cleaning-board.spec.ts). **Optimistic helpers:** [`apps/web/tests/unit/optimisticMove.test.ts`](../../apps/web/tests/unit/optimisticMove.test.ts).

## Commit deep dive

### `feat: implement month calendar api aggregating room lanes occupancy and conflict markers`
- Response must include:
  - room metadata.
  - booking cards with assignment state.
  - maintenance block intervals.
  - unresolved conflict markers.

### `feat: build month view room-lane interface with draggable booking cards`
- UI requirements:
  - clear room-lane headers.
  - visual distinction for assigned/unassigned/conflict.
  - tap target sizes suitable for mobile.
- **Prerequisite:** implement `/login` (see [Alignment with existing app](#alignment-with-existing-app-read-before-implementing)) in the same commit or an earlier Phase 6 commit so redirects from middleware work and E2E can sign in.

### `feat: add maintenance block create edit and delete UI wired to blocks api`
- Entry points: e.g. “Add block” on calendar toolbar or context action on a room lane.
- Editing loads existing block; deleting requires confirm dialog.
- On success: invalidate month query so lanes reflect new intervals immediately.

### `feat: add drag-drop between rooms with optimistic update and rollback on server reject`
- Optimistic pattern:
  - move card immediately.
  - call assign/reassign endpoint.
  - rollback + toast error on failure.

### `feat: add mobile-first interaction model for drag assign and quick booking actions`
- Must support touch gestures and fallback action menu where drag precision is poor.

### `feat: add unassigned queue drawer with one-tap assign and conflict explanation`
- Queue item fields should include dates, guest, and assign target (Phase 6: room picker or primary room from month payload; **suggested rooms / smart suggestions** are Phase 7 — see Appendix B).
- On conflict, show server message; map codes per Appendix A where applicable.

### `feat: build cleaning board ui for assignee and day-based operational execution`
- Filters required: day, assignee, status.
- Actions required: start task, complete task, reschedule.

### `test: add e2e tests for desktop and mobile allocation and cleaning operations`
- Minimum E2E paths (see [E2E automation vs product behavior](#e2e-automation-vs-product-behavior)):
  - login via `/login`, then `/app/calendar` and `/app/cleaning` navigation.
  - **desktop:** assign unassigned stay via **Unassigned queue** (same API as drag assign).
  - **desktop:** allocation conflict via **PATCH reassign** → `409 CONFLICT_ASSIGNMENT` (same API as failed drag).
  - maintenance block: create/cancel, **edit** seeded block (modal), optional **delete** with confirm, overlap create error.
  - **mobile viewport:** quick-assign sheet from booking card.
  - cleaning: todo → in_progress → done on **desktop and mobile** (with `seed:e2e` fixtures).

## API and UI contract examples

The **normative** month response is the unified `items` + `markers` shape in **Full commit specification** → **Commit `feat: implement month calendar api…`** below. The following is a shortened illustration only (same contract, one booking row + one block row):

```json
GET /api/calendar/month?month=2026-07
{
  "data": {
    "month": "2026-07",
    "timezone": "Etc/UTC",
    "rooms": [{ "id": "room_1", "code": "R1", "name": "Room 1" }],
    "items": [
      {
        "kind": "booking",
        "id": "bkg_1",
        "roomId": "room_1",
        "startDate": "2026-07-03",
        "endDate": "2026-07-07",
        "guestName": "Guest",
        "status": "confirmed",
        "assignmentId": "asg_1",
        "flags": []
      },
      {
        "kind": "block",
        "id": "blk_1",
        "roomId": "room_2",
        "startDate": "2026-07-10",
        "endDate": "2026-07-12",
        "reason": "Maintenance"
      }
    ],
    "markers": []
  }
}
```

**`items` rules**

- `kind: "booking"`: `roomId` is the assigned room when an assignment exists; omit or set `roomId` to `null` when unassigned (UI may show in an “unassigned” lane or only in the drawer). Include `flags` such as `unassigned` and/or `needs_reassignment` derived from `Booking.status` and presence of `assignmentId`.
- `kind: "block"`: manual maintenance block; `assignmentId` N/A.
- Sort `items` deterministically (e.g. by `startDate`, then `id`) for stable UI.

**`markers` rules**

- Backed by unresolved `ImportError` Prisma rows (`resolved = false`). There is **no** `bookingId` FK on that model; include `bookingId` in a marker only when the row’s `payload` JSON contains a reliable internal booking id. Otherwise omit `bookingId` and still return `message` / `code` / `severity` for operator visibility.

## Implementation blueprint by commit

### 6.1 `feat: implement month calendar api aggregating room lanes occupancy and conflict markers`
- Aggregate queries must be month-window bounded using `APP_TIMEZONE` for inclusive month boundaries.
- Sort lanes and cards deterministically for stable UI rendering.
- Include **markers** for unresolved `ImportError` rows (see marker rules above). **Allocation** state is expressed on booking `items` (`flags`, `needs_reassignment` status), not as a separate top-level `conflicts` array.

### 6.2 `feat: build month view room-lane interface with draggable booking cards`
- Add room-lane grid with keyboard-accessible interactions where possible.
- Card visual states: normal, unassigned, warning/conflict.

### 6.3 `feat: add maintenance block create edit and delete UI wired to blocks api`
- Reuse shared form validation for date ranges (start before end, month boundaries).
- Map `409` responses to inline field or toast errors.

### 6.4 `feat: add drag-drop between rooms with optimistic update and rollback on server reject`
- Client flow:
  1. optimistic local update.
  2. mutation request.
  3. confirm or rollback.
- Rollback must restore previous lane/date state exactly.

### 6.5 `feat: add mobile-first interaction model for drag assign and quick booking actions`
- Mobile must offer non-drag fallback action sheet for reliability.
- Ensure gestures do not block scroll unintentionally.

### 6.6 `feat: add unassigned queue drawer with one-tap assign and conflict explanation`
- Drawer list should support basic search and quick filters.
- One-tap assign action should show reason on failure.

### 6.7 `feat: build cleaning board ui for assignee and day-based operational execution`
- Daily board groups tasks by status and assignee.
- Optimistic status changes allowed with rollback on validation failure.

### 6.8 `test: add e2e tests for desktop and mobile allocation and cleaning operations`
- Required matrix (implemented in `apps/web/tests/e2e/`):
  - desktop: assign success via **unassigned queue** (stable automation; product drag is still manual/Phase 6 UI).
  - desktop: **conflict** = `PATCH /api/assignments/:id/reassign` returns `409` after overlap setup.
  - desktop: maintenance block — add/cancel, **edit** seeded block, overlap error on create; **delete** with `window.confirm`.
  - mobile (`390×844`): quick assign opens assign sheet.
  - cleaning: todo → done lifecycle on **both** projects.

## Expanded acceptance checklist
- Core operations are executable from phone and desktop without hidden admin steps.

---

## Full commit specification (exhaustive)

### UI component map (minimum)

| Component | Path | Responsibility |
|-----------|------|----------------|
| Login page | `apps/web/src/app/login/page.tsx` | `/login` — session cookie; required for `/app/*` E2E |
| Calendar page | `apps/web/src/app/app/calendar/page.tsx` | `/app/calendar` layout shell |
| Cleaning page | `apps/web/src/app/app/cleaning/page.tsx` | `/app/cleaning` layout shell |
| Month grid | `apps/web/src/modules/calendar/MonthGrid.tsx` | month columns |
| Room lane | `apps/web/src/modules/calendar/RoomLane.tsx` | vertical lane |
| Booking card | `apps/web/src/modules/calendar/BookingCard.tsx` | draggable |
| Block modal | `apps/web/src/modules/blocks/BlockEditorModal.tsx` | create/edit/delete maintenance blocks |
| Unassigned drawer | `apps/web/src/modules/bookings/UnassignedDrawer.tsx` | queue |
| Cleaning board | `apps/web/src/modules/cleaning/CleaningBoard.tsx` | filters + list |

### Test IDs (contract for E2E)

Prefix: `data-testid="ops-..."`.

| Element | ID |
|---------|-----|
| Room lane header | `ops-room-lane-{roomCode}` |
| Booking card | `ops-booking-card-{bookingId}` |
| Assign button | `ops-assign-quick-{bookingId}` |
| Block chip | `ops-block-chip-{blockId}` |

---

### Commit `feat: implement month calendar api aggregating room lanes occupancy and conflict markers`

#### Response shape (normative fields)

- `timezone`: echo `APP_TIMEZONE` from server env (see `@stay-ops/shared`); used by clients for display consistency.
- `rooms`: active (and optionally inactive) rooms for lanes; sort deterministically (e.g. by `code`).
- `items`: union of calendar entities (see **API and UI contract examples** above for `booking` vs `block` and flag rules).
- `markers`: import/sync issues; `bookingId` optional per payload parsing rules above.

```json
{
  "data": {
    "month": "2026-07",
    "timezone": "Etc/UTC",
    "rooms": [{ "id": "...", "code": "R1", "name": "..." }],
    "items": [
      {
        "kind": "booking",
        "id": "bkg_1",
        "roomId": "room_1",
        "startDate": "2026-07-03",
        "endDate": "2026-07-07",
        "guestName": "...",
        "status": "confirmed",
        "assignmentId": "asg_1",
        "flags": []
      },
      {
        "kind": "booking",
        "id": "bkg_2",
        "roomId": null,
        "startDate": "2026-07-15",
        "endDate": "2026-07-18",
        "guestName": "...",
        "status": "confirmed",
        "assignmentId": null,
        "flags": ["unassigned"]
      }
    ],
    "markers": [{ "kind": "import_error", "bookingId": null, "severity": "warning", "message": "..." }]
  }
}
```

#### Performance note
- For dense months, server should return **pre-aggregated** items per room or paginate—document max rows per response.

---

### Commit `feat: build month view room-lane interface with draggable booking cards`

#### Drag contract (dnd-kit or similar)
- `onDragEnd`: compute `{ bookingId, fromRoomId, toRoomId }` → if the booking was unassigned (`assignmentId` null / `flags` includes `unassigned`), `fromRoomId` may be a sentinel (e.g. `"unassigned"`) and the client calls `POST /api/assignments`; otherwise `PATCH /api/assignments/[assignmentId]/reassign` with the current assignment id from the card payload.

---

### Commit `feat: add drag-drop between rooms with optimistic update and rollback on server reject`

#### Client state machine
1. optimistic move card
2. await mutation
3. on failure: revert + toast with `error.code`

---

### Commit `feat: add mobile-first interaction model for drag assign and quick booking actions`

#### Breakpoint
- `<768px`: show bottom sheet for assign; drag optional.

---

### Commit `feat: add unassigned queue drawer with one-tap assign and conflict explanation`

#### Drawer data source
- `GET /api/bookings/unassigned?from=&to=`

---

### Commit `feat: build cleaning board ui for assignee and day-based operational execution`

#### Mutations
- Status change -> `PATCH /api/cleaning/tasks/:id/status`

---

### Commit `test: add e2e tests for desktop and mobile allocation and cleaning operations`

#### Playwright projects
- `desktop-chromium`
- `mobile-chromium` with viewport `390x844`

---

## Appendix A: Phase 6 UX error surfacing

| Server code | User message |
|-------------|--------------|
| `CONFLICT_ASSIGNMENT` | “That room is already booked for those nights.” |
| `CONFLICT_BLOCK` | “That room is blocked for maintenance.” |

---

## Appendix B: Handoff to Phase 7

- Phase 6 drawer: one-tap assign with a **room picker** (or similar) fed from calendar/month or room list APIs.
- Phase 7: enrich the same drawer with **suggestion cards** (ranked rooms, conflict explanations from a suggestions service). Do not block Phase 6 on suggestion APIs.

---

## Appendix C: Commit-by-commit implementation checklist (expanded)

### Month API commit
- [x] Month parameter validated `YYYY-MM` (`apps/web/tests/integration/calendar/month.api.test.ts` — `400` for invalid query).
- [x] Empty month returns empty items array, not error (same file — empty DB → `items: []`).

### Month UI commit
- [x] `data-testid` on every draggable card (`BookingCard` → `ops-booking-card-{id}`; `apps/web/tests/unit/BookingCard.test.tsx`).

### DnD commit
- [x] Optimistic rollback restores prior `roomId` on failure (`CalendarClient` `completeAssignment` snapshot + `apps/web/tests/unit/optimisticMove.test.ts` for `applyOptimisticBookingMove`).
- [x] Refetch calendar after successful mutation (`completeAssignment` → `load(month)`; `UnassignedDrawer` `onAssigned`).

### Mobile commit
- [x] Touch targets min 44px height for primary actions (`apps/web/src/app/globals.css` — `@media (max-width: 767px)` `.ops-btn`, `.ops-assign-quick`, `.ops-sheet-btn`).

### Unassigned drawer commit
- [x] Search debounced 200ms (`UnassignedDrawer` `useDebouncedValue(search, 200)`; `apps/web/tests/unit/UnassignedDrawer.test.tsx`).

### Cleaning board commit
- [x] Loading and empty states implemented (`CleaningBoard.tsx`; `apps/web/tests/unit/CleaningBoard.test.tsx` including empty list).

### E2E commit
- [x] Screenshots / traces on failure; CI uploads `playwright-report` + `test-results` artifacts on failure (`.github/workflows/e2e.yml`).

---

## Appendix D: Definition of ready for Phase 7

- [x] Desktop and mobile E2E green in CI (`.github/workflows/e2e.yml`) with `seed` + `seed:e2e` and `E2E_ADMIN_*` aligned to bootstrap admin.
- [x] Conflict errors human-readable (toast + `BlockEditorModal` code mapping per Appendix A).

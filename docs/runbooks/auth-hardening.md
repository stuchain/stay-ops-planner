# Auth hardening (Epic 7)

## Session cookie

- **Absolute TTL:** 12 hours from first login (`aexp` in the signed session payload).
- **Inactivity:** 60 minutes sliding window (`exp`). Each authenticated request through Next.js middleware may re-issue the cookie if the token is older than 5 minutes (refresh threshold), extending `exp` up to `aexp`.
- **Legacy tokens** (issued before Epic 7, without `aexp`): validated using `exp` only until they expire.

## Cookie `Secure`

- Env: `SESSION_COOKIE_SECURE=auto|true|false` (default **`auto`**).
- **`auto`:** `Secure` cookie is set only when `NODE_ENV=production`.
- **`true` / `false`:** force HTTPS-only cookie on or off (use `false` only for local HTTPS debugging).

## Login brute-force lockout

Counters are stored in Postgres (`login_attempts`).

- **Per email:** 5 failed attempts (wrong password or unknown user) within **15 minutes** → `429 RATE_LIMITED` with `Retry-After`.
- **Per IP:** 10 failed attempts within **15 minutes** → same response.
- Successful logins do **not** reset the per-IP failure count (prevents unlocking IP abuse with one valid account).

### Manual unlock (SQL)

Clear recent failures for one normalized email:

```sql
DELETE FROM login_attempts WHERE email = 'user@example.com';
```

Clear by IP:

```sql
DELETE FROM login_attempts WHERE ip = '203.0.113.50';
```

## API rate limits (`rate_limit_counters`)

- **Authenticated mutations** (bulk assign, bulk cancel, blocks, cleaning, suggestions apply): **60 requests / minute / user** by default.
- **Sync triggers** (`POST /api/sync/hosthub/reconcile`, `POST /api/sync/hosthub/enrichment-backfill`): **5 requests / minute / user**.
- **Login:** **60 requests / minute / IP** (in addition to brute-force rules above).

Expired counter windows are deleted opportunistically (no background job required for v1).

## Audit events

Login path writes (when DB audit succeeds):

- `auth.login.succeeded` — actor = user; meta includes `ip` and SHA-256 `emailHash` (lowercased email).
- `auth.login.failed` — same meta on bad password.
- `auth.login.locked_out` — when brute-force threshold trips before password check.

## Migrations

Epic 7 adds tables `login_attempts` and `rate_limit_counters`. Apply with:

```bash
corepack pnpm --filter @stay-ops/db exec prisma migrate deploy
```

**Staging / production:** use your normal release process (correct `DATABASE_URL`, backups, approvals). Do not force-push migrations; run `migrate deploy` only when you intend to apply pending SQL to that database.

## Prisma Client on Windows (`EPERM`)

If `prisma generate` fails with `EPERM` opening files under `node_modules\.prisma\client`, another process is usually holding locks (IDE, dev server, antivirus). Close the dev server, stop watchers, then retry. If it persists, delete `node_modules\.prisma` in the affected package and run `corepack pnpm --filter @stay-ops/db run generate` again.

## Smoke checks

### Scripted (no dev server)

From the repo root (requires `DATABASE_URL`, e.g. from `.env`):

```bash
corepack pnpm run smoke:epic7-auth
```

This script creates a throwaway user `epic7-smoke@local.test`, verifies six failed logins → `429` + `Retry-After`, decodes the session cookie payload for `iat` / `exp` / `aexp`, and exercises `refreshSessionTokenIfNeeded` past the 5-minute threshold using a fixed clock (same logic as middleware refresh, without waiting 6+ minutes on the wall clock).

### Manual with `pnpm dev`

1. **Lockout:** POST wrong password to `/api/auth/login` six times from the same IP; the sixth should return **429** and a **`Retry-After`** header.
2. **Payload:** after a successful login, decode the first segment of `stay_ops_session` (base64url JSON before the `.`) and confirm **`iat`**, **`exp`**, and **`aexp`** are present; first mint should satisfy `exp - iat === 3600` (60-minute inactivity window).
3. **Middleware refresh:** with a valid session cookie, wait **more than 6 minutes** (past the 5-minute refresh threshold), then hit any authenticated **`/api/*`** or **`/app/*`** route; the response should include a new **`Set-Cookie`** for `stay_ops_session` with a newer `iat` while **`aexp`** stays unchanged until the absolute cap.

## Login returns 401 with a password you believe is correct

The API still returns a generic **401** (`INVALID_CREDENTIALS`) for “no user”, “wrong password”, and “inactive user”. Use diagnostics to see which case applies.

### 1. Read-only CLI (`DATABASE_URL` from repo `.env`)

```powershell
$env:CHECK_USER_EMAIL = "info@heavensdoorsamos.gr"
corepack pnpm --filter @stay-ops/db run check-user
```

Interpretation:

- **`exists: false`** — no row for that email (case-insensitive). Create or reset the user (step 3).
- **`exists: true`, `isActive: false`** — account disabled. Upsert with `create-user` (sets `isActive: true`).
- **`lockedOut: true`** — five or more failed attempts for that email in the last 15 minutes. Clear with [Manual unlock (SQL)](#manual-unlock-sql), then retry or reset password.
- **`exists: true`, `lockedOut: false`** — row present; password likely wrong for this DB. Reset with `create-user` (step 3).

### 2. Dev-only HTTP (no auth; **disabled in production** — returns 404)

With `pnpm dev` and `NODE_ENV` not `production`:

```http
GET /api/auth/_diag?email=info@heavensdoorsamos.gr
```

Response `data`: `exists`, `isActive`, `role`, `recentFailedAttempts`, `lockedOut` (same semantics as above; no passwords or hashes).

### 3. Upsert password and re-enable (writes; use only on the DB you intend)

```powershell
$env:CREATE_USER_EMAIL = "info@heavensdoorsamos.gr"
$env:CREATE_USER_PASSWORD = "<at least 8 characters>"
$env:CREATE_USER_ROLE = "admin"   # or operator | viewer
corepack pnpm --filter @stay-ops/db run create-user
```

Confirm **`DATABASE_URL`** in `.env` points at the same Postgres instance your Next app uses (otherwise login will still fail against the “other” database).

# Auth Recovery & Credential Rotation Playbook (Phase 1)

This runbook covers emergency recovery and operational secret rotation for Phase 1 session-based internal authentication.

## 1. Rotate `SESSION_SECRET` (invalidate all sessions)

### Why
Session tokens are signed with `SESSION_SECRET`. Rotating it invalidates all existing session cookies immediately (signature no longer matches).

### Zero/low-downtime strategy
1. Confirm you can deploy config changes without downtime (container restart / redeploy).
2. Take a quick inventory of current `SESSION_SECRET` usage in your runtime environment (web service only in Phase 1).
3. Update `SESSION_SECRET` in the runtime configuration.
4. Redeploy/restart the web service so the new secret is picked up.

### Validation
1. With an existing session cookie from before the rotation, call `GET /api/auth/me`.
2. Expect `401` with:
   - `error.code = "UNAUTHORIZED"`
   - message `"Authentication required"`

## 2. Force logout all sessions procedure

In Phase 1, the supported and deterministic way to force logout is rotating `SESSION_SECRET` as described above.

After rotation, any previously issued `stay_ops_session` cookie will fail signature verification and will be treated as unauthenticated. Where the middleware runs, the cookie may also be cleared from the client response.

## 3. Admin password reset from CLI/SQL (safe path)

This section documents safe password reset options without exposing plaintext passwords in application logs.

### Option A (recommended): One-off seed upsert with bootstrap env
Phase 1 supports bootstrapping/upserting the admin user via the Prisma seed command using:
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

Use this only as an operator recovery step, not as a normal workflow.
1. Take a database backup/snapshot before making changes.
2. Run the seed command in a one-off operator context where you can provide the env vars securely.

Example (local or emergency shell context):
```bash
BOOTSTRAP_ADMIN_EMAIL="admin@example.com" \
BOOTSTRAP_ADMIN_PASSWORD="replace-with-new-strong-password" \
pnpm --filter @stay-ops/db seed
```

3. Validate by logging in via `POST /api/auth/login` using the new password.

### Option B: CLI/SQL update with a bcrypt hash
If you prefer direct SQL, generate a bcrypt hash out-of-band and then update the row.

1. Generate a bcrypt hash (do not print the plaintext password in logs).
   Example using `bcryptjs` in a one-off Node command:
```bash
node -e "import('bcryptjs').then(async ({default: bcrypt}) => { const password=process.env.PW; const hash=await bcrypt.hash(password, 12); console.log(hash); }).catch(e=>{console.error(e); process.exit(1);})"
```
2. Capture the printed hash value.
3. Update the admin row in Postgres:
```sql
UPDATE "users"
SET "password_hash" = '<bcrypt_hash_here>', "is_active" = TRUE
WHERE "email" = '<admin_email_here>';
```
4. Validate by logging in via `POST /api/auth/login` using the new password.

### Notes
- Ensure `is_active` is set to `TRUE` if you suspect lockout.
- Never commit or log plaintext passwords or session secrets.

## 4. Post-incident validation checklist

After applying recovery steps:
1. Secret rotation:
   - `GET /api/auth/me` returns `401 UNAUTHORIZED` when using a pre-rotation cookie.
2. Authentication:
   - Admin login (`POST /api/auth/login`) returns `200` and sets `stay_ops_session`.
   - `GET /api/auth/me` returns the expected admin identity with the new cookie.
3. Protection:
   - Calling a protected HTML route under `/app/*` redirects to `/login?next=...` when unauthenticated.
   - Calling a protected API route returns JSON `401` with `error.code = "UNAUTHORIZED"`.
4. Audit verification (Phase 8):
   - When Phase 8 adds audit trails, verify recovery actions are reflected in the audit log as required.


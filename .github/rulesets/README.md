# GitHub Rulesets (repo-as-code branch protection)

`main.json` codifies the required PR checks for the `main` branch. It is
GitHub's modern replacement for branch protection rules and is the source of
truth for "Epic 11: CI/CD Quality Gates".

Required checks defined here:

- `lint` — `pnpm lint` (ESLint)
- `typecheck` — `pnpm typecheck` (TypeScript no-emit, all packages)
- `unit` — `apps/web` Vitest unit project (jsdom, no DB)
- `schema-drift` — `prisma migrate diff` between `schema.prisma` and `prisma/migrations/`
- `integration` — Vitest integration project (real Postgres + Redis) including `prisma migrate status`
- `playwright` — `@smoke|@a11y` E2E on PR; full suite on `main`

The workflows that produce these check names live in `.github/workflows/`:

- `ci.yml` → `lint`, `typecheck`, `unit`
- `e2e.yml` → `schema-drift`, `integration`, `playwright`

`post-deploy-health` (from `health-check.yml`) is **not** in the required set
because it fires on `deployment_status` events, after merge.

## Apply once (admin)

Requires a token with `repo` admin scope (`gh auth login --scopes repo` is
sufficient for the maintainer running the import).

```bash
# From the repo root
gh api -X POST \
  -H "Accept: application/vnd.github+json" \
  "repos/${GITHUB_REPOSITORY:-OWNER/REPO}/rulesets" \
  --input .github/rulesets/main.json
```

## Update an existing ruleset

If `main.json` is edited later, update the existing ruleset by id (find it
with `gh api repos/OWNER/REPO/rulesets`):

```bash
gh api -X PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/OWNER/REPO/rulesets/<RULESET_ID>" \
  --input .github/rulesets/main.json
```

## Verify

```bash
gh api "repos/OWNER/REPO/rulesets" --jq '.[] | {id, name, enforcement}'
```

Open a PR that intentionally fails one of the required checks (e.g. add an
ESLint error) and confirm the merge button is blocked.

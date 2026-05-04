# GitHub Rulesets (repo-as-code branch protection)

`main.json` applies light **ref safety** on `main` only (no force-delete of the
branch, no non-fast-forward updates). It does **not** require pull requests and
does **not** block pushes on GitHub Actions status — so you can `git push` and
CI runs **after** the push like a normal repo.

Quality gates (`lint`, `typecheck`, `unit`, `schema-drift`, `integration`,
`playwright`) still run from [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
and [`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml) on every push
and pull request; treat red checks as release discipline, not a hard server-side
block. To block merges again, re-add a `required_status_checks` rule (or use a
separate ruleset / classic branch protection) once you are comfortable with the
bootstrap trade-off.

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

Confirm a failing commit still **pushes** to `main` while Actions shows red on
the commit; fix forward or revert as your process dictates.

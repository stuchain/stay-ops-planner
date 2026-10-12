#!/usr/bin/env sh
# Vercel build step (apps/web/vercel.json buildCommand), run from the repo root.
#
# Production: migrations must apply cleanly (`migrate deploy` then `migrate status`), or the
# deployment is not shipped.
# Preview: every branch shares one preview database, so a branch's migration can clash with what
# another branch already created there (one failed migration then blocks every later preview).
# Previews still try to migrate, but a failure only warns and the build continues.
set -eu

db() { pnpm --filter @stay-ops/db exec prisma "$@"; }

if [ "${VERCEL_ENV:-}" = "preview" ]; then
  if ! db migrate deploy; then
    echo "Warning: preview database migrations failed; building the preview anyway (screens using new tables may error)."
  fi
else
  db migrate deploy
  db migrate status
fi

pnpm build:web

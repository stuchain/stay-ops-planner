#!/usr/bin/env bash
# Create stayops_test on the Postgres service (GitHub Actions or any host with createdb).
# Safe to run repeatedly: ignores "already exists".
set -euo pipefail
export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-stayops}"
export PGPASSWORD="${PGPASSWORD:-stayops}"
createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" stayops_test 2>/dev/null || true
echo "ci-ensure-test-db: stayops_test ready"

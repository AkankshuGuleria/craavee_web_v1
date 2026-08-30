#!/usr/bin/env bash
# Run the pgTAP suite in supabase/tests/ against the local Supabase Postgres.
#
# Why not `supabase test db`: its bundled pg_prove chokes on a repo path
# containing a space (this repo lives at "/Volumes/T7 Shield/..."). This
# script drives each *_test.sql file through psql directly and parses the
# TAP output itself — same assertions, same DB, no pg_prove.
#
# Usage:
#   scripts/run-db-tests.sh                 # all tests
#   scripts/run-db-tests.sh 03 05           # only files whose name contains 03 or 05
#
# Env: DB_URL overrides the connection string (default: local supabase db).
set -uo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../supabase/tests" && pwd)"

shopt -s nullglob
ALL_FILES=()
for f in "$TESTS_DIR"/*_test.sql; do ALL_FILES+=("$f"); done

FILES=()
if [ "$#" -gt 0 ]; then
  for f in "${ALL_FILES[@]+"${ALL_FILES[@]}"}"; do
    for pat in "$@"; do
      case "$(basename "$f")" in *"$pat"*) FILES+=("$f");; esac
    done
  done
else
  FILES=("${ALL_FILES[@]+"${ALL_FILES[@]}"}")
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "No test files matched." >&2
  exit 1
fi

total_fail=0
total_files=0
for f in "${FILES[@]}"; do
  total_files=$((total_files + 1))
  name="$(basename "$f")"
  out="$(psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=0 -f "$f" 2>&1)"
  not_ok="$(grep -c '^not ok' <<<"$out" || true)"
  err="$(grep -c '^psql:.*ERROR:' <<<"$out" || true)"
  planline="$(grep -oE '^1\.\.[0-9]+' <<<"$out" | head -1)"
  plannum="${planline#1..}"
  ranok="$(grep -c '^ok ' <<<"$out" || true)"

  if [ "$not_ok" -eq 0 ] && [ "$err" -eq 0 ] && [ -n "$planline" ] && [ "$ranok" -eq "${plannum:-0}" ]; then
    echo "PASS  $name  (${ranok}/${plannum} assertions)"
  else
    total_fail=$((total_fail + 1))
    echo "FAIL  $name  (not-ok=${not_ok}, psql-errors=${err}, plan=${planline:-none})"
    grep -E '^(not ok|# |psql:.*ERROR:)' <<<"$out" | sed 's/^/      /' | head -40
  fi
done

echo "----------------------------------------"
if [ "$total_fail" -eq 0 ]; then
  echo "ALL GREEN — ${total_files} test file(s) passed"
  exit 0
else
  echo "${total_fail}/${total_files} test file(s) FAILED"
  exit 1
fi

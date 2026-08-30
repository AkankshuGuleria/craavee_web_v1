#!/usr/bin/env bash
# Serve the Phase 4 Edge Functions locally.
#
# Why not `supabase functions serve`: the CLI edge-runtime container fails
# to boot on the maintainer's machine ("failed to determine entrypoint" —
# a CLI/image issue, not a function-code issue; see
# PHASE_4_IMPLEMENTATION_REPORT.md §20). This runs the SAME handler code
# via `deno run`, routing /functions/v1/<name> exactly as the deployed
# edge runtime does (supabase/functions/_dev/serve.ts). The handlers, the
# Postgres they talk to, and the JWT verification path are identical to
# production.
#
# Env (all have local defaults matching `supabase start`):
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
#   FUNCTIONS_PORT (default 8790)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Pull local defaults from the running stack if the vars aren't already set.
if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ] || [ -z "${SUPABASE_URL:-}" ]; then
  eval "$(supabase status -o env 2>/dev/null | sed 's/^/export CRV_/')"
  export SUPABASE_URL="${SUPABASE_URL:-${CRV_API_URL:-http://127.0.0.1:54321}}"
  export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-${CRV_ANON_KEY:-}}"
  export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${CRV_SERVICE_ROLE_KEY:-}}"
fi

export CRAAVEE_ALLOW_MOCK_CONTROL="${CRAAVEE_ALLOW_MOCK_CONTROL:-1}"
export FUNCTIONS_PORT="${FUNCTIONS_PORT:-8790}"

exec deno run \
  --allow-net --allow-env \
  --config "$ROOT/supabase/functions/deno.json" \
  "$ROOT/supabase/functions/_dev/serve.ts"

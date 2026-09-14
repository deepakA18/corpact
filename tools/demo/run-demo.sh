#!/usr/bin/env bash
# Run the Corpact demo from a fresh clone: check prerequisites, install, start Postgres, run.
#
#   tools/demo/run-demo.sh                        # Surfpool (default)
#   tools/demo/run-demo.sh solana-test-validator  # Agave test validator
#
# The demo creates everything else itself: its own `corpact_demo` database (migrated and labelled synthetic),
# tenant and API keys, a local network with generated keys, and issuer fixtures. It never reads the repo `.env`,
# never calls the issuer, and needs no RPC key. Exit code is the demo's: 0 only if every check passes.
set -euo pipefail

VALIDATOR="${1:-surfpool}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail() { echo "✗ $*" >&2; exit 2; }
ok() { echo "✓ $*"; }

case "$VALIDATOR" in
  surfpool | solana-test-validator) ;;
  *) fail "validator must be surfpool or solana-test-validator, got: $VALIDATOR" ;;
esac

# ── Prerequisites ────────────────────────────────────────────────────────────────────────────────────────────
command -v node >/dev/null || fail "Node 24 is required"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || fail "Node 24 or later is required (found $(node -v))"
ok "node $(node -v)"

command -v pnpm >/dev/null || fail "pnpm 10 is required: corepack enable && corepack prepare pnpm@10.17.0 --activate"
ok "pnpm $(pnpm -v)"

command -v docker >/dev/null || fail "Docker is required for the local Postgres"
docker info >/dev/null 2>&1 || fail "Docker is installed but not running"
ok "docker running"

if [ "$VALIDATOR" = surfpool ]; then
  command -v surfpool >/dev/null || fail "Surfpool 1.0 is required: brew install txtx/taps/surfpool"
  ok "$(surfpool --version 2>/dev/null | head -1)"
else
  command -v solana-test-validator >/dev/null || fail "solana-test-validator is required: https://docs.anza.xyz/cli/install"
  ok "$(solana-test-validator --version 2>/dev/null | head -1)"
fi

if lsof -iTCP:8899 -sTCP:LISTEN >/dev/null 2>&1; then
  fail "port 8899 is in use: stop the other validator first (the demo never attaches to an existing node)"
fi

# ── Install ──────────────────────────────────────────────────────────────────────────────────────────────────
pnpm install --frozen-lockfile
ok "dependencies installed"

# ── Postgres on 127.0.0.1:54329 ──────────────────────────────────────────────────────────────────────────────
pg_ready() { node -e '
  const net = require("node:net");
  const s = net.connect(54329, "127.0.0.1", () => { s.end(); process.exit(0); });
  s.on("error", () => process.exit(1));
' ; }
if pg_ready && docker ps --format '{{.Names}}' | grep -qx parityfi-postgres; then
  ok "Postgres already running (container parityfi-postgres)"
else
  pg_ready && fail "something other than the parityfi-postgres container is listening on 127.0.0.1:54329"
  docker compose up -d --wait postgres
  ok "Postgres started"
fi

# ── Run ──────────────────────────────────────────────────────────────────────────────────────────────────────
echo "Running the demo on $VALIDATOR (about 5 minutes)…"
DEMO_VALIDATOR="$VALIDATOR" NO_DNA=1 pnpm --filter @corpact/demo demo

#!/usr/bin/env bash
# Backup and restore drill for the ledger database (docs/ops/backup-restore.md).
#
# Dumps the database, restores the dump into a scratch database, and proves the copy is sound:
#   - every append-only table in the copy holds at least as many rows as before the dump started
#     and no more than after it finished (the worker may be writing meanwhile);
#   - `verify-integrity` passes on the copy: evidence hashes, append-only guards, journal invariants.
# The dump is kept in backups/ (gitignored: it holds wallet addresses). Exits 1 if anything fails.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONTAINER="${PG_CONTAINER:-parityfi-postgres}"
PG_ROLE="${PG_ROLE:-parityfi}"
SOURCE_DB="${SOURCE_DB:-parityfi}"
DRILL_DB="corpact_restore_drill"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
BASE_URL="${DATABASE_URL:-postgres://parityfi:parityfi-dev@127.0.0.1:54329/parityfi}"
TABLES=(chain_observations multiplier_writes corporate_actions balance_movements ledger_journal provider_checks)

sql() { docker exec -i "$CONTAINER" psql -U "$PG_ROLE" -d "$1" -v ON_ERROR_STOP=1 -Atq -c "$2"; }
counts() { for t in "${TABLES[@]}"; do sql "$1" "SELECT count(*) FROM $t"; done; }

mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/$SOURCE_DB-$(date -u +%Y%m%dT%H%M%SZ).dump"
started=$(date +%s)

before=($(counts "$SOURCE_DB"))
docker exec "$CONTAINER" pg_dump -U "$PG_ROLE" -d "$SOURCE_DB" --format=custom > "$DUMP"
after=($(counts "$SOURCE_DB"))
dumped=$(date +%s)
echo "dump      $DUMP ($(du -h "$DUMP" | cut -f1), sha256 $(shasum -a 256 "$DUMP" | cut -d' ' -f1)) in $((dumped - started))s"

sql postgres "DROP DATABASE IF EXISTS $DRILL_DB WITH (FORCE)"
sql postgres "CREATE DATABASE $DRILL_DB"
docker exec -i "$CONTAINER" pg_restore -U "$PG_ROLE" -d "$DRILL_DB" --exit-on-error --no-owner < "$DUMP"
restored_at=$(date +%s)
echo "restore   into $DRILL_DB in $((restored_at - dumped))s"

status=0
restored=($(counts "$DRILL_DB"))
for i in "${!TABLES[@]}"; do
  verdict=PASS
  if (( restored[i] < before[i] || restored[i] > after[i] )); then verdict=FAIL; status=1; fi
  printf '%s  rows %-20s source %s..%s, copy %s\n' "$verdict" "${TABLES[$i]}" "${before[$i]}" "${after[$i]}" "${restored[$i]}"
done

# Integrity of the copy, from a clean environment: the repo .env (and its RPC key) is not loaded.
DRILL_URL=$(node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; console.log(u.toString())' "$BASE_URL" "$DRILL_DB")
if ! (cd "$ROOT/apps/worker" && env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$DRILL_URL" node_modules/.bin/tsx src/main.ts verify-integrity 2>/dev/null); then
  status=1
fi

echo "total     $(( $(date +%s) - started ))s"
if [[ "${KEEP_DRILL_DB:-0}" != 1 ]]; then sql postgres "DROP DATABASE $DRILL_DB WITH (FORCE)"; fi
if (( status == 0 )); then echo "restore drill passed"; else echo "restore drill FAILED"; fi
exit $status

#!/bin/bash
# Traceform restore script
# Usage: ./restore.sh /path/to/postgres-20260327.dump

set -euo pipefail

DUMP_FILE="${1:?Usage: $0 <postgres-dump-file>}"
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-traceform}"
PG_DB="${PG_DB:-traceform}"

echo "[$(date)] Restoring PostgreSQL from $DUMP_FILE..."
echo "WARNING: This will overwrite the current database. Press Ctrl+C to cancel."
sleep 5

PGPASSWORD="${PGPASSWORD:-traceform_dev}" pg_restore \
    -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" \
    -d "$PG_DB" --clean --if-exists \
    "$DUMP_FILE"

echo "[$(date)] Restore complete!"
echo "[$(date)] Run 'make migrate' to ensure schema is up to date."

#!/bin/bash
# AgentStack backup script
# Run daily via cron: 0 2 * * * /path/to/backup.sh

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/agentstack}"
DATE=$(date +%Y%m%d-%H%M%S)
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-agentstack}"
PG_DB="${PG_DB:-agentstack}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting AgentStack backup..."

# PostgreSQL backup
echo "[$(date)] Backing up PostgreSQL..."
PGPASSWORD="${PGPASSWORD:-agentstack_dev}" pg_dump \
    -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$PG_DB" \
    --format=custom \
    --file="$BACKUP_DIR/postgres-$DATE.dump"

echo "[$(date)] PostgreSQL backup: $(du -h "$BACKUP_DIR/postgres-$DATE.dump" | cut -f1)"

# ClickHouse backup (metadata only — data is in materialized views)
echo "[$(date)] Backing up ClickHouse schema..."
clickhouse-client --query "SHOW CREATE DATABASE agentstack" > "$BACKUP_DIR/clickhouse-schema-$DATE.sql" 2>/dev/null || true
for table in sessions spans events healing_events; do
    clickhouse-client --query "SHOW CREATE TABLE agentstack.$table" >> "$BACKUP_DIR/clickhouse-schema-$DATE.sql" 2>/dev/null || true
done

# Cleanup old backups
echo "[$(date)] Cleaning up backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "*.dump" -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "*.sql" -mtime "+$RETENTION_DAYS" -delete

echo "[$(date)] Backup complete!"
ls -lh "$BACKUP_DIR"/*-$DATE* 2>/dev/null

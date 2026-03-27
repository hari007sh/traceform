# Traceform Operational Runbook

This runbook covers common operational scenarios for the Traceform platform. Each section describes the symptoms, diagnosis steps, and resolution procedures.

---

## 1. Service Won't Start

**Symptoms:** Process exits immediately, port not listening, health check fails.

### Diagnosis

1. Check the process logs for startup errors:
   ```bash
   journalctl -u traceform-server --since "5 minutes ago"
   # or if running via Docker:
   docker compose logs server --tail=50
   ```

2. Verify required environment variables are set:
   ```bash
   # All of these must be defined:
   echo $DATABASE_URL
   echo $CLICKHOUSE_URL
   echo $REDIS_URL
   echo $NATS_URL
   echo $JWT_SECRET
   echo $ENCRYPTION_KEY
   ```

3. Check if the port is already in use:
   ```bash
   lsof -i :8080   # API server
   lsof -i :8090   # Gateway
   ```

4. Check Docker service health:
   ```bash
   docker compose ps
   docker compose logs postgres --tail=20
   docker compose logs clickhouse --tail=20
   ```

### Resolution

- **Missing env vars:** Copy from `.env.example`, fill in values, and restart.
- **Port conflict:** Stop the conflicting process or change the port in config.
- **Database not ready:** Wait for Docker health checks to pass, then restart the server.
- **Migration error:** Run `make migrate` to apply pending migrations.

---

## 2. High Memory Usage

**Symptoms:** `process_resident_memory_bytes` exceeds threshold, OOM kills in logs, degraded response times.

### Diagnosis

1. Check current memory usage:
   ```bash
   curl -s http://localhost:8080/metrics | grep process_resident_memory_bytes
   ```

2. Check goroutine count for leaks:
   ```bash
   curl -s http://localhost:8080/metrics | grep go_goroutines
   ```

3. If running in Kubernetes, check pod resource usage:
   ```bash
   kubectl top pods -l app=traceform-server
   ```

4. Check for goroutine leaks with pprof:
   ```bash
   go tool pprof http://localhost:8080/debug/pprof/heap
   ```

### Resolution

- **High goroutine count (>10,000):** Likely a goroutine leak. Check for missing context cancellation in long-running operations. Restart the affected service as an immediate mitigation.
- **Steady memory growth:** Check NATS consumer buffer sizes in the worker. Reduce `BATCH_SIZE` if the worker is accumulating too many events in memory.
- **OOM kill:** Increase the container memory limit. For Kubernetes: update the `resources.limits.memory` in the Helm values.
- **Immediate relief:** Restart the worker process. It will reconnect to NATS and resume consuming.

---

## 3. ClickHouse Slow Queries

**Symptoms:** Dashboard analytics pages load slowly, `/v1/analytics/*` endpoints have high latency, ClickHouse CPU spikes.

### Diagnosis

1. Check currently running queries:
   ```bash
   clickhouse-client --query "SELECT query_id, elapsed, query FROM system.processes ORDER BY elapsed DESC LIMIT 10"
   ```

2. Check recent slow queries:
   ```bash
   clickhouse-client --query "
     SELECT query, query_duration_ms, read_rows, read_bytes
     FROM system.query_log
     WHERE type = 'QueryFinish'
       AND query_duration_ms > 5000
     ORDER BY event_time DESC
     LIMIT 20
   "
   ```

3. Check table sizes:
   ```bash
   clickhouse-client --query "
     SELECT table, formatReadableSize(sum(bytes_on_disk)) as size, sum(rows) as rows
     FROM system.parts
     WHERE database = 'agentstack' AND active
     GROUP BY table
     ORDER BY sum(bytes_on_disk) DESC
   "
   ```

### Resolution

- **Missing skip index:** Add a minmax or set skip index on the filtered column. Example:
  ```sql
  ALTER TABLE traceform.spans ADD INDEX idx_org_id org_id TYPE set(100) GRANULARITY 4;
  ALTER TABLE traceform.spans MATERIALIZE INDEX idx_org_id;
  ```
- **Unoptimized materialized view:** Check that materialized views use the correct `ORDER BY` matching common query patterns.
- **Too many parts:** Run `OPTIMIZE TABLE traceform.spans FINAL` to merge parts. Consider increasing `merge_max_block_size`.
- **Increase memory for large aggregations:** Set per-query memory limit:
  ```bash
  clickhouse-client --max_memory_usage=10000000000 --query "..."
  ```

---

## 4. NATS Message Backlog

**Symptoms:** Ingested events delayed in appearing on the dashboard, NATS stream consumer lag increasing, worker logs show slow processing.

### Diagnosis

1. Check NATS stream info:
   ```bash
   nats stream info traceform-events
   # Or via HTTP monitoring:
   curl -s http://localhost:8222/jsz | python3 -m json.tool
   ```

2. Check consumer lag:
   ```bash
   nats consumer info traceform-events traceform-worker
   ```

3. Check worker health:
   ```bash
   curl -s http://localhost:8080/health | python3 -m json.tool
   docker compose logs worker --tail=50
   ```

### Resolution

- **Worker not running:** Restart the worker: `docker compose restart worker`.
- **Worker processing slowly:** Scale workers horizontally. In Kubernetes:
  ```bash
  kubectl scale deployment traceform-worker --replicas=3
  ```
- **Consumer stuck:** Reset the consumer to replay from a specific sequence:
  ```bash
  nats consumer edit traceform-events traceform-worker --deliver=last
  ```
- **Dead letter messages:** Check the dead letter subject for poison messages that repeatedly fail:
  ```bash
  nats sub "traceform.deadletter.>" --count=10
  ```
- **Stream storage full:** Increase the stream limits or reduce retention:
  ```bash
  nats stream edit traceform-events --max-msgs=10000000 --max-age=72h
  ```

---

## 5. PostgreSQL Connection Exhaustion

**Symptoms:** API returns 500 errors, logs show "too many connections" or "connection pool exhausted", new queries time out.

### Diagnosis

1. Check current connections:
   ```bash
   psql -h localhost -U agentstack -d agentstack -c "
     SELECT state, count(*)
     FROM pg_stat_activity
     WHERE datname = 'agentstack'
     GROUP BY state;
   "
   ```

2. Check max connections setting:
   ```bash
   psql -h localhost -U agentstack -d agentstack -c "SHOW max_connections;"
   ```

3. Check for long-running queries:
   ```bash
   psql -h localhost -U agentstack -d agentstack -c "
     SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
     FROM pg_stat_activity
     WHERE datname = 'agentstack'
       AND state != 'idle'
     ORDER BY duration DESC
     LIMIT 10;
   "
   ```

### Resolution

- **Too many idle connections:** Reduce `SetMaxOpenConns` in the Go server (currently 25). Ensure `SetMaxIdleConns` and `SetConnMaxLifetime` are set.
- **Long-running queries:** Kill the blocking query:
  ```bash
  psql -c "SELECT pg_terminate_backend(<pid>);"
  ```
- **Increase PostgreSQL limit:** Edit `postgresql.conf`:
  ```
  max_connections = 200
  ```
  Then restart PostgreSQL.
- **Add PgBouncer:** For production, place PgBouncer in front of PostgreSQL for connection pooling:
  ```bash
  # docker-compose addition
  pgbouncer:
    image: edoburu/pgbouncer
    environment:
      DATABASE_URL: postgresql://agentstack:password@postgres:5432/agentstack
      MAX_CLIENT_CONN: 200
      DEFAULT_POOL_SIZE: 25
  ```

---

## 6. High Error Rate

**Symptoms:** Error rate panel in Grafana shows >1% 5xx responses, alert fires, users reporting failures.

### Diagnosis

1. Check error rate from Prometheus:
   ```bash
   curl -s http://localhost:8080/metrics | grep traceform_http_requests_total
   ```

2. Check recent server logs for errors:
   ```bash
   docker compose logs server --since "10 minutes ago" | grep -i error
   ```

3. Check which endpoints are failing:
   ```bash
   curl -s 'http://localhost:9090/api/v1/query?query=topk(5,rate(traceform_http_requests_total{status=~"5.."}[5m]))'
   ```

4. Check health endpoint for degraded dependencies:
   ```bash
   curl -s http://localhost:8080/health | python3 -m json.tool
   ```

### Resolution

- **Dependency down:** Check the `/health` endpoint. If a dependency shows "unhealthy", fix that dependency first (see corresponding runbook section).
- **Recent deployment caused regression:** Roll back to the previous version (see Section 10: Emergency Rollback).
- **Rate limiting:** If 429s are spiking, check if a single client is flooding. Adjust rate limits in Redis config.
- **Panic recovery:** Check logs for panic stack traces. The chi Recoverer middleware catches panics but they indicate bugs that need fixing.

---

## 7. Disk Space Full

**Symptoms:** Writes failing, ClickHouse errors about disk space, PostgreSQL WAL accumulation.

### Diagnosis

1. Check disk usage:
   ```bash
   df -h
   du -sh /var/lib/clickhouse/data/agentstack  /* legacy db name *//*
   du -sh /var/lib/postgresql/data/
   ```

2. Check ClickHouse table sizes:
   ```bash
   clickhouse-client --query "
     SELECT table, formatReadableSize(sum(bytes_on_disk)) as size
     FROM system.parts
     WHERE database = 'agentstack' AND active
     GROUP BY table
     ORDER BY sum(bytes_on_disk) DESC
   "
   ```

3. Check for dead letter files:
   ```bash
   du -sh /var/lib/traceform/deadletter/
   ```

### Resolution

- **ClickHouse data too large:** Apply or tighten TTL retention:
  ```sql
  ALTER TABLE traceform.spans MODIFY TTL created_at + INTERVAL 90 DAY;
  ALTER TABLE traceform.events MODIFY TTL created_at + INTERVAL 90 DAY;
  ```
  Then force cleanup:
  ```bash
  clickhouse-client --query "OPTIMIZE TABLE traceform.spans FINAL"
  ```
- **PostgreSQL WAL bloat:** Check for replication slots that are not advancing:
  ```bash
  psql -c "SELECT slot_name, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) FROM pg_replication_slots;"
  ```
  Drop unused slots if necessary.
- **Dead letter cleanup:** Archive or delete old dead letter messages:
  ```bash
  find /var/lib/traceform/deadletter/ -mtime +7 -delete
  ```
- **Backup cleanup:** Run the backup retention cleanup:
  ```bash
  RETENTION_DAYS=7 ./scripts/backup.sh
  ```

---

## 8. Certificate Expiry

**Symptoms:** HTTPS errors in browser, TLS handshake failures, Caddy warning logs.

### Diagnosis

1. Check Caddy logs for certificate renewal issues:
   ```bash
   docker compose logs caddy --tail=50 | grep -i cert
   ```

2. Check certificate expiry:
   ```bash
   echo | openssl s_client -connect yourdomain.com:443 2>/dev/null | openssl x509 -noout -dates
   ```

3. Check if Caddy can reach ACME provider:
   ```bash
   docker compose exec caddy curl -s https://acme-v02.api.letsencrypt.org/directory
   ```

### Resolution

- **Caddy auto-renewal working:** Caddy handles certificate renewal automatically. If there is a temporary ACME failure, Caddy will retry. Check logs for errors.
- **DNS not resolving:** Ensure the domain points to the correct IP. Caddy needs this for HTTP-01 challenge validation.
- **Port 80/443 blocked:** Caddy needs port 80 open for ACME HTTP-01 challenges. Check firewall rules.
- **Force renewal:**
  ```bash
  docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
  ```
- **Manual certificate (fallback):** If automatic renewal is impossible, provide certificates manually in the Caddyfile:
  ```
  yourdomain.com {
    tls /path/to/cert.pem /path/to/key.pem
    ...
  }
  ```

---

## 9. Scaling Up

**Symptoms:** Sustained high CPU/memory usage, increasing latency, approaching resource limits.

### Horizontal Scaling (Kubernetes/Helm)

1. **Scale API server replicas:**
   ```bash
   kubectl scale deployment traceform-server --replicas=3
   # Or via Helm values:
   helm upgrade traceform deploy/helm/agentstack --set server.replicas=3
   ```

2. **Scale workers:**
   ```bash
   kubectl scale deployment traceform-worker --replicas=5
   helm upgrade traceform deploy/helm/agentstack --set worker.replicas=5
   ```

3. **Scale gateway:**
   ```bash
   kubectl scale deployment traceform-gateway --replicas=3
   helm upgrade traceform deploy/helm/agentstack --set gateway.replicas=3
   ```

### Vertical Scaling

4. **Increase ClickHouse resources:**
   ```bash
   helm upgrade traceform deploy/helm/agentstack \
     --set clickhouse.resources.requests.memory=8Gi \
     --set clickhouse.resources.limits.memory=16Gi
   ```

5. **Add ClickHouse shards** for write throughput:
   - Update the ClickHouse cluster configuration to add new shards.
   - Rebalance data using `SYSTEM RESHARDING` or create new distributed tables.
   - Update the worker connection strings to include new shard endpoints.

6. **Scale PostgreSQL:**
   - Add read replicas for query-heavy workloads.
   - Point read-only API endpoints to the replica using a separate `DATABASE_READONLY_URL`.

### Verification

After scaling, verify the system is healthy:
```bash
curl -s http://localhost:8080/health | python3 -m json.tool
curl -s http://localhost:8080/ready | python3 -m json.tool
kubectl top pods -l app.kubernetes.io/name=traceform
```

---

## 10. Emergency Rollback

**Symptoms:** A new deployment caused errors, data corruption, or degraded performance.

### Helm Rollback

1. List recent releases:
   ```bash
   helm history traceform
   ```

2. Roll back to the previous version:
   ```bash
   helm rollback traceform <REVISION>
   ```

3. Verify health after rollback:
   ```bash
   kubectl rollout status deployment/traceform-server
   kubectl rollout status deployment/traceform-gateway
   kubectl rollout status deployment/traceform-worker
   curl -s http://localhost:8080/health | python3 -m json.tool
   ```

### Docker Compose Rollback

1. Stop the current deployment:
   ```bash
   docker compose down
   ```

2. Check out the previous known-good version:
   ```bash
   git log --oneline -5
   git checkout <previous-commit-sha>
   ```

3. Rebuild and restart:
   ```bash
   docker compose build
   docker compose up -d
   ```

4. Verify health:
   ```bash
   curl -s http://localhost:8080/health | python3 -m json.tool
   ```

### Database Rollback (if migrations were applied)

If the new deployment included database migrations that need reverting:

```bash
# Check current migration version
make migrate-status

# Roll back the last migration
make migrate-down

# Or restore from backup if data was corrupted
./scripts/restore.sh /var/backups/traceform/postgres-YYYYMMDD-HHMMSS.dump
```

### Post-Rollback Checklist

- [ ] Health endpoint returns "healthy"
- [ ] Ready endpoint returns "ready" (all dependencies green)
- [ ] Dashboard loads without errors
- [ ] Ingest pipeline is processing events (check NATS consumer lag)
- [ ] Gateway is proxying requests successfully
- [ ] Error rate is back to baseline
- [ ] Notify the team about the rollback and root cause

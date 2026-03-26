# Enterprise-Scale Data Optimization Design

**Date:** 2026-03-25
**Target:** 1M+ sessions/day (Enterprise scale)
**Scope:** 4 optimizations — Materialized Views, Hybrid Sampling, Payload Truncation + Blob, TTL Retention

---

## 1. Context

AgentStack ingests trace data (sessions, spans, events) from AI agent SDKs. Current architecture:

- **SDK** batches events (50 per batch, 5s flush) and sends to API
- **API** (Go, port 8080) validates and publishes to NATS per-entity
- **Worker** consumes NATS, batch-writes to ClickHouse (100 items, 2s flush)
- **ClickHouse** stores all raw data in 5 tables: sessions, spans, events, healing_events, gateway_requests
- **Dashboard** queries raw tables on every page load with aggregation functions

### Problems at scale

| Issue | Impact at 1M sessions/day |
|-------|--------------------------|
| No pre-aggregation | Dashboard queries scan millions of rows, p99 >5s |
| No sampling | 4M+ spans/day all written, storage grows ~240GB/day |
| Full payloads inline | 50KB+ per span for LLM I/O, dominates storage |
| No TTL | Data grows unbounded, query perf degrades over time |

---

## 2. Materialized Views (Pre-aggregated Metrics)

### 2.1 Design

Four materialized views using ClickHouse `AggregatingMergeTree` engine. Data is aggregated at INSERT time with zero query-time overhead.

### 2.2 Views

**`mv_sessions_hourly`** — Aggregate session metrics per org, agent, hour.

All MVs use explicit `TO` target tables so backfill can INSERT directly into the
target table. This is required because ClickHouse MVs only trigger on new INSERTs
to the source table — they cannot retroactively process existing data.

```sql
CREATE TABLE agentstack.mv_sessions_hourly_data (
    org_id UUID,
    agent_name LowCardinality(String),
    hour DateTime,
    session_count AggregateFunction(count, UInt64),
    failed_count AggregateFunction(countIf, UInt8),
    healed_count AggregateFunction(countIf, UInt8),
    completed_count AggregateFunction(countIf, UInt8),
    timeout_count AggregateFunction(countIf, UInt8),
    total_tokens AggregateFunction(sum, UInt64),
    total_cost_cents AggregateFunction(sum, UInt64),
    sum_duration_ms AggregateFunction(sum, UInt64),
    max_duration_ms AggregateFunction(max, UInt64),
    min_duration_ms AggregateFunction(min, UInt64)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (org_id, hour, agent_name);

CREATE MATERIALIZED VIEW agentstack.mv_sessions_hourly
TO agentstack.mv_sessions_hourly_data
AS SELECT
    org_id,
    agent_name,
    toStartOfHour(started_at) AS hour,
    countState() AS session_count,
    countIfState(status = 'failed') AS failed_count,
    countIfState(status = 'healed') AS healed_count,
    countIfState(status = 'completed') AS completed_count,
    countIfState(status = 'timeout') AS timeout_count,
    sumState(total_tokens) AS total_tokens,
    sumState(total_cost_cents) AS total_cost_cents,
    sumState(duration_ms) AS sum_duration_ms,
    maxState(duration_ms) AS max_duration_ms,
    minState(duration_ms) AS min_duration_ms
FROM agentstack.sessions
GROUP BY org_id, agent_name, hour;
```

Average duration is computed at query time: `sumMerge(sum_duration_ms) / countMerge(session_count)`.
This sum+count pattern enables correct cross-table merges with counter data (you cannot
combine `avgMerge` from one table with raw sums from another).

Backfill command inserts directly into the target table:
```sql
INSERT INTO agentstack.mv_sessions_hourly_data
SELECT org_id, agent_name, toStartOfHour(started_at) AS hour,
    countState() AS session_count, ...
FROM agentstack.sessions
GROUP BY org_id, agent_name, hour;
```

**`mv_spans_hourly`** — Aggregate span metrics per org, model, provider, span_type, hour.

```sql
CREATE TABLE agentstack.mv_spans_hourly_data (
    org_id UUID,
    model LowCardinality(String),
    provider LowCardinality(String),
    span_type LowCardinality(String),
    hour DateTime,
    span_count AggregateFunction(count, UInt64),
    failed_count AggregateFunction(countIf, UInt8),
    total_input_tokens AggregateFunction(sum, UInt64),
    total_output_tokens AggregateFunction(sum, UInt64),
    total_tokens AggregateFunction(sum, UInt64),
    total_cost_cents AggregateFunction(sum, UInt32),
    sum_duration_ms AggregateFunction(sum, UInt64),
    max_duration_ms AggregateFunction(max, UInt64)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (org_id, hour, model, provider);

CREATE MATERIALIZED VIEW agentstack.mv_spans_hourly
TO agentstack.mv_spans_hourly_data
AS SELECT
    org_id,
    model,
    provider,
    span_type,
    toStartOfHour(started_at) AS hour,
    countState() AS span_count,
    countIfState(status = 'failed') AS failed_count,
    sumState(input_tokens) AS total_input_tokens,
    sumState(output_tokens) AS total_output_tokens,
    sumState(total_tokens) AS total_tokens,
    sumState(cost_cents) AS total_cost_cents,
    sumState(duration_ms) AS sum_duration_ms,
    maxState(duration_ms) AS max_duration_ms
FROM agentstack.spans
GROUP BY org_id, model, provider, span_type, hour;
```

**`mv_healing_hourly`** — Aggregate healing metrics per org, healing_type, hour.

```sql
CREATE TABLE agentstack.mv_healing_hourly_data (
    org_id UUID,
    healing_type LowCardinality(String),
    hour DateTime,
    total_count AggregateFunction(count, UInt64),
    success_count AggregateFunction(countIf, UInt8),
    sum_latency_ms AggregateFunction(sum, UInt64)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (org_id, hour, healing_type);

CREATE MATERIALIZED VIEW agentstack.mv_healing_hourly
TO agentstack.mv_healing_hourly_data
AS SELECT
    org_id,
    healing_type,
    toStartOfHour(created_at) AS hour,
    countState() AS total_count,
    countIfState(success = 1) AS success_count,
    sumState(latency_ms) AS sum_latency_ms
FROM agentstack.healing_events
GROUP BY org_id, healing_type, hour;
```

**`mv_cost_daily`** — Daily cost rollup per org, model, provider.

Note: The spans table does not have `agent_name`. To get per-agent cost breakdowns,
the API layer joins this view with session data or uses `mv_sessions_hourly` for
agent-level cost. This view focuses on model-level cost attribution.

```sql
CREATE TABLE agentstack.mv_cost_daily_data (
    org_id UUID,
    model LowCardinality(String),
    provider LowCardinality(String),
    day DateTime,
    span_count AggregateFunction(count, UInt64),
    total_input_tokens AggregateFunction(sum, UInt64),
    total_output_tokens AggregateFunction(sum, UInt64),
    total_cost_cents AggregateFunction(sum, UInt32),
    avg_cost_cents AggregateFunction(avg, UInt32)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (org_id, day, model, provider);

CREATE MATERIALIZED VIEW agentstack.mv_cost_daily
TO agentstack.mv_cost_daily_data
AS SELECT
    org_id,
    model,
    provider,
    toStartOfDay(started_at) AS day,
    countState() AS span_count,
    sumState(input_tokens) AS total_input_tokens,
    sumState(output_tokens) AS total_output_tokens,
    sumState(cost_cents) AS total_cost_cents,
    avgState(cost_cents) AS avg_cost_cents
FROM agentstack.spans
WHERE cost_cents > 0
GROUP BY org_id, model, provider, day;
```

### 2.3 Query Pattern

Read from MVs using `-Merge` combinators:

```sql
SELECT
    countMerge(session_count) AS total_sessions,
    countMerge(failed_count) AS total_failed,
    sumMerge(total_cost_cents) AS total_cost,
    sumMerge(sum_duration_ms) / countMerge(session_count) AS avg_duration
FROM agentstack.mv_sessions_hourly_data
WHERE org_id = ? AND hour >= ? AND hour <= ?
```

### 2.4 API Changes

- `internal/trace/store/clickhouse.go`: New methods `GetOverviewFromMV()`, `GetSessionsOverTimeFromMV()`, `GetFailureRateFromMV()` that query MVs
- `internal/trace/service/analytics.go`: Switch to MV-backed methods, fall back to raw queries for time ranges before MV creation
- Existing raw-table queries remain for session list, session detail, and span detail views

### 2.5 Backfill

New CLI command: `agentstack migrate --backfill-views` that runs `INSERT INTO mv_sessions_hourly SELECT ...` from existing raw data. Only needed once after migration.

---

## 3. Hybrid Adaptive Sampling

### 3.1 SDK-Side Sampling

New `SamplingConfig` dataclass added to SDK init:

```python
agentstack.init(
    api_key="...",
    sampling=SamplingConfig(
        rate=0.1,                 # Keep 10% of successful sessions
        always_keep_errors=True,  # 100% of failed/healed/timeout
        always_keep_slow_ms=5000, # 100% of sessions > 5s
        always_keep_costly=500,   # 100% of sessions > $5.00
    )
)
```

**SDK buffering for sampling:**

When sampling is enabled (rate < 1.0), the SDK buffers ALL events for a session
in memory instead of streaming them to the batch sender. At `session.end()`, the
sampling decision is made:

- If **keep**: flush all buffered events to the batch sender (normal path)
- If **drop**: discard buffered events, send only a counter event

This is a significant change to `session.py` — events are held in `session._buffer`
instead of being sent via `client.send_event()` during execution. Memory guard:
buffer is capped at 1000 events per session (if exceeded, oldest events are dropped
from buffer but a warning is logged).

When sampling rate = 1.0 (default), buffering is disabled and events stream normally.

**Decision logic (at session.end()):**

```python
def should_send_full(session, config):
    if config.rate >= 1.0:
        return True  # No sampling, send everything
    if session.status in ('failed', 'healed', 'timeout'):
        return True  # Always send errors
    if session.duration_ms and session.duration_ms > config.always_keep_slow_ms:
        return True  # Always send slow
    if session.total_cost_cents > config.always_keep_costly:
        return True  # Always send expensive
    return random.random() < config.rate  # Probabilistic
```

**Counter events for sampled-out sessions:**

When a session is sampled out, the SDK sends a lightweight counter event containing
aggregate metrics only (no spans, no payloads). The `org_id` is injected by the
server from the API key context (not sent by the SDK).

```json
{
    "type": "session_counter",
    "agent_name": "Support Agent",
    "status": "completed",
    "total_tokens": 450,
    "total_cost_cents": 12,
    "duration_ms": 2300,
    "span_count": 3,
    "timestamp": "2026-03-25T10:00:00Z"
}
```

The server injects `org_id` from the authenticated API key context before publishing
to NATS. This ensures counters are correctly attributed even though the SDK does not
send `org_id` directly.

This ensures aggregated metrics (total sessions, total cost, avg duration) remain accurate even with aggressive sampling.

### 3.2 Server-Side Sampling

**Sampling config table (PostgreSQL):**

```sql
CREATE TABLE sampling_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    agent_name TEXT DEFAULT '*',  -- '*' means all agents
    sample_rate REAL NOT NULL DEFAULT 1.0,
    always_keep_errors BOOLEAN DEFAULT TRUE,
    always_keep_slow_ms INTEGER DEFAULT 5000,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(org_id, agent_name)
);
```

**Ingest handler behavior:**

1. On each ingest request, check sampling_config for the org+agent
2. If session status is error/healed/timeout → always accept
3. If session is successful → accept probabilistically based on server rate
4. Rejected sessions: extract counter data, publish to `trace.ingest.counter`
5. Return `X-AgentStack-Sample-Rate: 0.1` header so SDK can adapt

**API endpoints:**

- `GET /v1/settings/sampling` — list sampling configs for org
- `PUT /v1/settings/sampling` — upsert sampling config
- `DELETE /v1/settings/sampling/{id}` — delete config

**Adaptive mode:**

Background check in budget_checker worker: if hourly ingest count > threshold (default 100K), auto-adjust sample_rate for successful sessions. Formula:

```
new_rate = max(0.01, min(1.0, threshold / current_hourly_count))
```

Floor of 1% prevents complete data blackout from misconfiguration.

### 3.3 Counter Events Table (ClickHouse)

Uses `AggregatingMergeTree` (not `SummingMergeTree`) to correctly handle both
summable metrics (tokens, cost, count) and non-summable metrics (duration for averages).
ORDER BY uses bucketed `hour` (not raw timestamp) so rows actually merge.

```sql
CREATE TABLE agentstack.session_counters (
    org_id UUID,
    agent_name LowCardinality(String),
    status LowCardinality(String),
    hour DateTime,
    session_count AggregateFunction(count, UInt64),
    sum_tokens AggregateFunction(sum, UInt64),
    sum_cost_cents AggregateFunction(sum, UInt64),
    sum_duration_ms AggregateFunction(sum, UInt64),
    sum_span_count AggregateFunction(sum, UInt32)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (org_id, agent_name, status, hour);
```

Counter events are inserted via:
```sql
INSERT INTO agentstack.session_counters
SELECT
    org_id, agent_name, status,
    toStartOfHour(created_at) AS hour,
    countState() AS session_count,
    sumState(total_tokens) AS sum_tokens,
    sumState(total_cost_cents) AS sum_cost_cents,
    sumState(duration_ms) AS sum_duration_ms,
    sumState(span_count) AS sum_span_count
FROM (SELECT ... FROM incoming_counter_event)
GROUP BY org_id, agent_name, status, hour;
```

In practice, the worker batches counter events and inserts with `countState()`/`sumState()`
wrappers. Average duration is computed at query time: `sumMerge(sum_duration_ms) / countMerge(session_count)`.

### 3.4 MV + Counter Merge

The API query layer merges MV data (from fully-ingested sessions) with counter data
(from sampled-out sessions) at matching granularity: `(org_id, agent_name, hour)`.

```sql
-- Overview query: merge MV sessions + counters at same granularity.
-- Both tables use sum+count pattern so averages are mathematically correct.
SELECT
    countMerge(mv.session_count) + countMerge(c.session_count) AS total_sessions,
    sumMerge(mv.total_cost_cents) + sumMerge(c.sum_cost_cents) AS total_cost,
    (sumMerge(mv.sum_duration_ms) + sumMerge(c.sum_duration_ms))
        / (countMerge(mv.session_count) + countMerge(c.session_count)) AS avg_duration
FROM agentstack.mv_sessions_hourly_data mv
FULL OUTER JOIN agentstack.session_counters c
    ON mv.org_id = c.org_id AND mv.agent_name = c.agent_name AND mv.hour = c.hour
WHERE mv.org_id = ? AND mv.hour >= ? AND mv.hour <= ?
   OR c.org_id = ? AND c.hour >= ? AND c.hour <= ?
```

---

## 4. Payload Truncation + Blob Storage

### 4.1 Truncation Rules

| Field | Max inline size | Truncation marker |
|-------|----------------|-------------------|
| `span.input` | 4096 bytes | `...[truncated, full: {hash}]` |
| `span.output` | 4096 bytes | `...[truncated, full: {hash}]` |
| `session.input` | 4096 bytes | Same |
| `session.output` | 4096 bytes | Same |

### 4.2 New ClickHouse Columns

```sql
ALTER TABLE agentstack.spans
    ADD COLUMN input_truncated UInt8 DEFAULT 0,
    ADD COLUMN output_truncated UInt8 DEFAULT 0,
    ADD COLUMN input_hash String DEFAULT '',
    ADD COLUMN output_hash String DEFAULT '';
```

### 4.3 Blob Storage Interface

```go
type BlobStore interface {
    Put(ctx context.Context, hash string, data []byte) error
    Get(ctx context.Context, hash string) ([]byte, error)
    Delete(ctx context.Context, hash string) error
    Exists(ctx context.Context, hash string) (bool, error)
}
```

Two implementations:

- `FileSystemBlobStore` — stores at `{base_path}/{hash[:2]}/{hash[2:4]}/{hash}` (sharded directories to avoid filesystem limits)
- `S3BlobStore` — stores at `s3://{bucket}/payloads/{hash[:2]}/{hash}`

Config via env:
```
BLOB_STORE_TYPE=fs          # fs | s3
BLOB_STORE_PATH=/data/payloads   # for fs
BLOB_STORE_BUCKET=agentstack     # for s3
BLOB_STORE_REGION=us-east-1      # for s3
```

### 4.4 Write Path (in ingest_writer.go)

```
For each span in batch:
  if len(span.Input) > 4096:
    hash = SHA256(span.Input)
    blobStore.Put(hash, span.Input)  // Dedup: skips if exists
    span.Input = span.Input[:4093] + "...[truncated, full: " + hash[:16] + "]"
    span.InputTruncated = 1
    span.InputHash = hash
  // Same for Output
```

### 4.5 Read Path (new endpoint)

```
GET /v1/spans/{span_id}/payload?field=input|output

1. Query ClickHouse for span's input_hash or output_hash
2. If empty → return inline data (not truncated)
3. If hash exists → blobStore.Get(hash) → return full payload
4. 404 if blob expired/missing
```

### 4.6 Dashboard Integration

Session detail / span detail page adds:

```tsx
{span.input_truncated && (
    <Button variant="ghost" size="sm" onClick={() => fetchFullPayload(span.id, 'input')}>
        Show full input
    </Button>
)}
```

Lazy-loads full payload only when user clicks.

---

## 5. TTL-Based Tiered Retention

### 5.1 Tier Definitions

| Tier | Duration | Data Kept | Enforcement |
|------|----------|-----------|-------------|
| Hot | 7-30 days (per-org) | Full raw data + full blob payloads | Default |
| Warm | 30-90 days (per-org) | Failed/healed: 100%. Success: 10%. Payloads truncated to 1KB | RetentionWorker |
| Cold | Forever | Materialized view aggregates only | ClickHouse TTL auto-delete |

### 5.2 Per-Org Configuration

New columns on `organizations` table:

```sql
ALTER TABLE organizations
    ADD COLUMN hot_retention_days INTEGER NOT NULL DEFAULT 7,
    ADD COLUMN warm_retention_days INTEGER NOT NULL DEFAULT 90,
    ADD COLUMN blob_retention_days INTEGER NOT NULL DEFAULT 30;
```

Exposed in existing settings page (the "Default Retention Period" dropdown already exists).

### 5.3 ClickHouse TTL

Set TTL to 365 days as a hard ceiling (the maximum enterprise retention).
Per-org shorter retention is enforced by the retention worker.
This prevents enterprise customer data from being deleted prematurely.

```sql
ALTER TABLE agentstack.sessions
    MODIFY TTL started_at + INTERVAL 365 DAY DELETE;

ALTER TABLE agentstack.spans
    MODIFY TTL started_at + INTERVAL 365 DAY DELETE;

ALTER TABLE agentstack.events
    MODIFY TTL created_at + INTERVAL 365 DAY DELETE;

ALTER TABLE agentstack.healing_events
    MODIFY TTL created_at + INTERVAL 365 DAY DELETE;

ALTER TABLE agentstack.gateway_requests
    MODIFY TTL created_at + INTERVAL 365 DAY DELETE;
```

Per-org enforcement: the retention worker deletes data for orgs with shorter
configured retention periods. The 365-day TTL is a safety net, not the primary mechanism.

### 5.4 Retention Worker

New worker: `retention_worker.go`, runs **daily** (not hourly — mutations are expensive).

**Important ClickHouse constraint:** The project rule (CLAUDE.md #5) states "ClickHouse
is append-only — NEVER update rows." We respect this by using partition-level drops
and targeted DELETE mutations only for downsampling (not updates).

**Warm tier downsampling (daily DELETE mutation):**

```sql
-- Delete 90% of successful sessions past the hot boundary.
-- Uses lightweight DELETE (not ALTER TABLE UPDATE) and runs once daily.
-- cityHash64(id) % 10 is deterministic — same session always kept or dropped.
DELETE FROM agentstack.sessions
WHERE
    org_id = ?
    AND status = 'completed'
    AND started_at < now() - INTERVAL ? DAY    -- hot boundary
    AND started_at >= now() - INTERVAL ? DAY   -- warm boundary
    AND cityHash64(id) % 10 != 0;             -- keep 1 in 10

-- Also delete corresponding spans for removed sessions
DELETE FROM agentstack.spans
WHERE
    org_id = ?
    AND session_id IN (
        SELECT id FROM agentstack.sessions
        WHERE org_id = ? AND status = 'completed'
        AND started_at < now() - INTERVAL ? DAY
        AND started_at >= now() - INTERVAL ? DAY
        AND cityHash64(id) % 10 != 0
    );
```

Note: We do NOT use `ALTER TABLE UPDATE` for payload truncation — this violates
the append-only rule and causes expensive part rewrites. Instead, payloads are
truncated at ingest time (section 4.4) and blob storage handles full payload
lifecycle independently.

**Cold tier deletion (partition drops):**

For data past the warm boundary, use partition-level drops when an entire monthly
partition is expired (near-instant, no mutation overhead):

```go
// If all data in a monthly partition is older than warm_retention_days:
// DROP PARTITION is O(1) — deletes entire data parts instantly
ALTER TABLE agentstack.sessions DROP PARTITION '202601';
```

For partial-month deletions (when warm boundary falls mid-month), use DELETE mutation
run daily to minimize impact.

**Blob cleanup:**

```go
// Runs daily, checks ALL orgs (blobs may be shared across orgs via dedup):
// 1. Query spans with non-empty input_hash/output_hash older than blob_retention_days
// 2. Collect unique hashes scheduled for cleanup
// 3. For each hash: check if ANY non-expired span across ALL orgs still references it
// 4. If zero references remain → blobStore.Delete(hash)
// 5. Log cleanup stats: blobs_deleted, bytes_freed
```

### 5.5 Failed Session Protection

Failed, healed, and timeout sessions are NEVER downsampled. They are only deleted when they cross the warm→cold boundary (TTL auto-delete). This ensures incident traces are always available for the full retention window.

---

## 6. New Files

| File | Purpose |
|------|---------|
| `migrations/clickhouse/003_materialized_views.up.sql` | 4 MVs, session_counters, payload columns |
| `migrations/clickhouse/003_materialized_views.down.sql` | Drop MVs and new tables |
| `migrations/postgres/011_sampling_retention.up.sql` | sampling_config table, org retention columns |
| `migrations/postgres/011_sampling_retention.down.sql` | Reverse |
| `internal/storage/blob.go` | BlobStore interface + FS + S3 implementations |
| `internal/storage/blob_test.go` | Unit tests |
| `internal/worker/retention_worker.go` | TTL enforcement, downsampling, blob cleanup |
| `internal/worker/retention_worker_test.go` | Unit tests |
| `internal/trace/handler/payload.go` | GET /v1/spans/{id}/payload |
| `internal/trace/handler/sampling.go` | Sampling config CRUD endpoints |
| `internal/trace/service/sampling.go` | Sampling config service |
| `internal/trace/store/sampling_pg.go` | PostgreSQL store for sampling config |
| `sdk/python/agentstack/sampling.py` | SamplingConfig + decision logic |
| `sdk/typescript/src/sampling.ts` | TypeScript SamplingConfig + decision logic |

## 7. Modified Files

| File | Changes |
|------|---------|
| `internal/worker/ingest_writer.go` | Payload truncation + blob offload in write path, counter event handling |
| `internal/trace/store/clickhouse.go` | New MV-backed query methods |
| `internal/trace/service/analytics.go` | Switch to MV queries with raw fallback |
| `internal/trace/service/ingest.go` | Server-side sampling, counter events, sample rate header |
| `internal/trace/handler/ingest.go` | Sampling check, X-AgentStack-Sample-Rate header |
| `internal/server/routes.go` | Register new endpoints (payload, sampling) |
| `cmd/worker/main.go` | Start retention worker |
| `cmd/migrate/main.go` | Backfill command for MVs |
| `internal/config/config.go` | Blob store config, sampling defaults |
| `sdk/python/agentstack/__init__.py` | Sampling config in init() |
| `sdk/python/agentstack/session.py` | Sampling decision at session.end() |
| `sdk/python/agentstack/client.py` | Counter events, X-AgentStack-Sample-Rate header parsing |
| `sdk/python/agentstack/batch.py` | Counter event support |
| `web/app/dashboard/sessions/[id]/page.tsx` | "Show full payload" button |
| `sdk/typescript/src/session.ts` | Session buffering + sampling decision |
| `sdk/typescript/src/client.ts` | Counter events, X-AgentStack-Sample-Rate header parsing |
| `web/app/dashboard/settings/page.tsx` | Retention period config (hot/warm) |

---

## 8. Testing Strategy

| Area | Test Type | What |
|------|-----------|------|
| Materialized Views | Integration | Insert raw data, verify MV aggregates match manual calculation |
| Sampling (SDK) | Unit | Verify always-keep rules, probabilistic rate, counter emission |
| Sampling (Server) | Integration | Verify config lookup, adaptive rate adjustment |
| Blob Store | Unit | Put/Get/Delete/Exists for both FS and S3 backends |
| Payload Truncation | Integration | Insert large span, verify truncation + blob storage + on-demand fetch |
| Retention Worker | Integration | Insert data across time ranges, run worker, verify correct deletion/downsampling |
| Counter Merge | Integration | Sample out sessions, verify aggregates still accurate via counters |
| API Endpoints | Integration | Payload fetch, sampling config CRUD |
| MV + Counter Accuracy | Integration | Sample out 90% of sessions, verify total_sessions and avg_duration match 100% ingest baseline |
| Retention Mutation Perf | Load | Run retention worker against 100K sessions, verify completion <60s |
| Migration Rollback | Integration | Run up migration, verify tables/views exist, run down, verify clean state |
| SDK Session Buffering | Unit | Verify buffer cap (1000 events), flush-on-keep, discard-on-drop, memory bounds |
| SDK Sampling Override | Integration | Server returns X-AgentStack-Sample-Rate, SDK respects it on next session |

---

## 9. Performance Expectations

| Metric | Before | After |
|--------|--------|-------|
| Dashboard p99 query latency | 2-5s at 1M sessions | <100ms (MVs) |
| Daily storage growth (1M sessions) | ~240GB | ~30GB (sampling + truncation) |
| Blob deduplication ratio | N/A | 60-80% for template-heavy agents |
| Counter accuracy loss | N/A | 0% (counters preserve aggregates) |
| Cold storage (after 90 days) | Full raw data | ~500 bytes/session (MV rows only) |

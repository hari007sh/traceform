# Traceform Enterprise Production Hardening

**Date:** 2026-03-26
**Status:** Approved
**Goal:** Make Traceform production-ready for enterprise-scale workloads (50K+ events/sec, millions of sessions, 10K+ concurrent gateway requests)

---

## Problem Statement

Traceform captures every LLM message from AI agent sessions. At enterprise scale this means millions of events per day. The current implementation has critical issues that will cause crashes (OOM, panics), data loss, and unusable UI under real load. This spec covers 27 fixes across 4 phases.

---

## Phase 1: Stop the Crashes (Infrastructure P0)

### 1.1 Request Body Size Limits

**Files:** `internal/server/middleware/bodylimit.go` (new), `internal/server/routes.go`, `cmd/gateway/main.go`

Add `http.MaxBytesReader` middleware for all ingest and gateway endpoints:
- Ingest endpoints (`/v1/ingest/*`): 10MB limit
- Gateway proxy (`/v1/chat/completions`, `/v1/embeddings`): 10MB limit
- Playground execute: 1MB limit
- All other endpoints: 5MB default

Implementation: Create a `BodyLimit(maxBytes int64)` middleware that wraps `r.Body` with `http.MaxBytesReader`. Apply it per route group in `routes.go`.

### 1.2 Bounded Ingestion Buffers + Dead Letter

**File:** `internal/worker/ingest_writer.go`

Current state: Unbounded slices grow until OOM. Failed batches re-queued forever.

Fix:
- Add `maxBufferSize = 50000` constant (configurable via `MAX_BUFFER_SIZE` env var)
- In each `handle*` callback, check `len(buffer) >= maxBufferSize`. If full, drop the message and increment a `dropped_events` counter logged every 10 seconds.
- Add `retryCount` field to batch metadata. After 3 failed flush attempts, write the batch to a dead-letter file (`/tmp/traceform/deadletter/YYYY-MM-DD-HH-type.jsonl`) and discard from buffer.
- Add exponential backoff between retries: 1s, 2s, 4s.

### 1.3 NATS Queue Groups for Horizontal Scaling

**Files:** `internal/worker/ingest_writer.go`

Change all `nc.Subscribe(subject, handler)` to `nc.QueueSubscribe(subject, "ingest-workers", handler)`. This allows running multiple worker processes that share the message load evenly.

Subjects to change:
- `trace.ingest.session`
- `trace.ingest.span`
- `trace.ingest.event`
- `trace.ingest.healing`
- `trace.ingest.counter`
- `test.run.execute`
- `webhooks.>`

### 1.4 Batch Size + Flush Tuning

**File:** `internal/worker/ingest_writer.go`

Change defaults and make configurable:
- `batchSize`: 100 -> 10000 (env: `INGEST_BATCH_SIZE`)
- `flushInterval`: 2s -> 5s (env: `INGEST_FLUSH_INTERVAL_MS`)

### 1.5 Per-Buffer Mutexes + Concurrent Flush

**File:** `internal/worker/ingest_writer.go`

Replace single `sync.Mutex` with:
```go
sessionMu   sync.Mutex
spanMu      sync.Mutex
eventMu     sync.Mutex
healingMu   sync.Mutex
counterMu   sync.Mutex
```

Change `flush()` to flush all buffer types concurrently:
```go
func (w *IngestWriter) flush() {
    var wg sync.WaitGroup
    wg.Add(5)
    go func() { defer wg.Done(); w.flushSessions() }()
    go func() { defer wg.Done(); w.flushSpans() }()
    go func() { defer wg.Done(); w.flushEvents() }()
    go func() { defer wg.Done(); w.flushHealing() }()
    go func() { defer wg.Done(); w.flushCounters() }()
    wg.Wait()
}
```

### 1.6 Gateway Shutdown Fix

**File:** `cmd/gateway/main.go`, `internal/route/gateway/logger.go`

Fix shutdown ordering in `main.go`:
1. `srv.Shutdown(ctx)` — drain in-flight requests (increase timeout to 30s for streaming)
2. `asyncLogger.Stop()` — flush remaining logs
3. `natsConn.Close()` — close event stream
4. `router.Stop()` — stop route refresh

Fix panic in `logger.go`:
- Add `atomic.Bool` flag `stopped` to AsyncLogger
- In `Log()`, check `stopped` before sending to channel
- Use `select` with default to avoid blocking on full channel

Also fix:
- `ReadTimeout` -> `ReadHeaderTimeout` (don't kill streaming body reads)
- Add `MaxHeaderBytes: 64 * 1024` to http.Server

### 1.7 Docker Compose Hardening

**File:** `docker-compose.yml`

- Pin ClickHouse: `clickhouse/clickhouse-server:24.8` (not `latest`)
- Add resource limits:
  - ClickHouse: 4GB memory, 2 CPUs
  - PostgreSQL: 1GB memory, 1 CPU
  - Redis: 512MB memory
  - NATS: 512MB memory
- Add NATS persistent volume + storage config: `--store_dir /data --max_mem 256MB`
- Add network isolation: separate `frontend` and `backend` networks

---

## Phase 2: Make the UI Usable at Scale

### 2.1 Server-Side Pagination, Search, and Filter

**Files:** `web/app/dashboard/sessions/page.tsx`, `internal/trace/handler/sessions.go`, `internal/trace/store/clickhouse.go`

Backend changes:
- `ListSessions` handler accepts query params: `page`, `per_page`, `search`, `status`, `agent_name`, `sort_by`, `sort_dir`, `start`, `end`
- ClickHouse query adds WHERE clauses for each filter
- Return `{ sessions: [...], meta: { page, per_page, total, total_pages } }`
- Add LIMIT/OFFSET to spans query (`GetSessionSpans`): default limit 500, paginated

Frontend changes:
- Remove client-side filtering entirely
- Send all filter params as URL search params (`useSearchParams`)
- Debounce search input (300ms) before sending to API
- Paginator with ellipsis (1 2 3 ... 8 9 10)
- Page size selector (25, 50, 100)
- Column sorting (click headers)

### 2.2 Global Time Range Picker

**Files:** `web/components/time-range-picker.tsx` (new), `web/app/dashboard/layout.tsx`

Component with presets: Last 15m, 1h, 4h, 1d, 7d, 30d, Custom (date pickers).

State management:
- Store selected range in URL search params (`?range=7d` or `?start=...&end=...`)
- Dashboard layout provides `useTimeRange()` hook that all pages consume
- All API calls pass `start` and `end` timestamps
- Auto-refresh toggle with intervals: Off, 10s, 30s, 1m, 5m

### 2.3 O(N) Span Depth Computation

**File:** `web/app/dashboard/sessions/[id]/page.tsx`

Replace recursive `getDepth()` with single-pass hash map:
```typescript
function computeDepths(spans: Span[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  const spanMap = new Map(spans.map(s => [s.id, s]));
  function getDepth(id: string): number {
    if (depthMap.has(id)) return depthMap.get(id)!;
    const span = spanMap.get(id);
    if (!span?.parent_id) { depthMap.set(id, 0); return 0; }
    const d = 1 + getDepth(span.parent_id);
    depthMap.set(id, d);
    return d;
  }
  spans.forEach(s => getDepth(s.id));
  return depthMap;
}
```

This is O(N) with memoization vs. the current O(N^2*D).

### 2.4 Virtual Scrolling for Span Trees

**File:** `web/app/dashboard/sessions/[id]/page.tsx`

- Install `react-virtuoso` (`npm install react-virtuoso`)
- Replace `orderedSpans.map(...)` with `<Virtuoso data={orderedSpans} itemContent={renderSpan} />`
- Add collapsible subtrees: click a parent span to collapse/expand children
- Only render visible rows (typically 20-30 on screen)

### 2.5 Chart Downsampling + Zoom

**Files:** `web/lib/downsample.ts` (new), all chart components

Implement LTTB (Largest-Triangle-Three-Buckets) algorithm:
- Input: array of `{x, y}` points, target count (default 500)
- Output: downsampled array preserving visual shape

Apply to all chart components before rendering:
- AreaChart, LineChart, StackedAreaChart

Add X-axis label thinning:
- Calculate available width / label width
- Only render every Nth label to prevent overlap

Add brush zoom:
- Click-drag on chart to select time range
- Zooms into selected range
- "Reset zoom" button

### 2.6 Wire Up SessionReplay Component

**File:** `web/app/dashboard/sessions/[id]/page.tsx`

The `components/session-replay.tsx` D3 Gantt chart already exists. Replace the inline span rendering (lines 349-484) with `<SessionReplay>` component. Add:
- Minimap for navigating large traces
- Click span bar to expand detail panel
- Healing intervention markers on timeline

---

## Phase 3: Harden Gateway & SDKs

### 3.1 Circuit Breakers

**File:** `internal/route/gateway/circuitbreaker.go` (new), `internal/route/gateway/fallback.go`

Per-provider circuit breaker with 3 states:
- **Closed** (normal): requests pass through. Track consecutive failures.
- **Open** (after 5 consecutive failures): skip provider for 30 seconds. Return error immediately.
- **Half-open** (after 30s): allow 1 probe request. If success -> Closed. If fail -> Open.

State stored in-memory per provider ID. Integrate into fallback chain: skip providers with open circuit.

### 3.2 Streaming Token Tracking

**File:** `internal/route/gateway/proxy.go`

In the streaming loop, parse SSE chunks:
- Accumulate `data: {...}` chunks
- When `data: [DONE]` is received, parse the final usage object
- If no usage in final chunk, estimate from accumulated content length
- Pass actual token counts to `logRequest()` and `recordCostEvent()`

### 3.3 Singleflight Route Cache

**File:** `internal/route/gateway/router.go`

- Replace global cache wipe with per-org TTL (60s staleness)
- Use `golang.org/x/sync/singleflight` for `loadOrg()`:
```go
result, err, _ := r.sfGroup.Do("load:"+orgID, func() (interface{}, error) {
    return r.loadOrgFromDB(ctx, orgID)
})
```
- Clear adapters map when providers change (detect via updated_at comparison)

### 3.4 Context Cancellation in Stream Loop

**File:** `internal/route/gateway/proxy.go`

Add context check in the streaming loop:
```go
for {
    select {
    case <-r.Context().Done():
        stream.Close()
        return
    default:
    }
    n, err := stream.Read(buf)
    if n > 0 {
        if _, writeErr := w.Write(buf[:n]); writeErr != nil {
            stream.Close()
            return
        }
        flusher.Flush()
    }
    ...
}
```

### 3.5 Python SDK Thread Safety

**Files:** `sdk/python/traceform/client.py`, `sdk/python/traceform/batch.py`, `sdk/python/traceform/healing.py`

Client:
- Use `threading.local()` for per-thread `requests.Session`
- Register `atexit.register(client.shutdown)` in `init()`

BatchSender:
- Add `max_retries = 3` per batch. After max retries, drop with warning log.
- Add exponential backoff: 1s, 2s, 4s
- Remove `_drain_and_flush()` call from `add()` (only flush from background thread)

HealingEngine:
- Add `threading.Lock` for `call_history`, `total_cost_cents`, `interventions`
- Cap `call_history` at 1000 entries (ring buffer)
- Use `collections.Counter` for loop detection instead of linear scan

### 3.6 TypeScript SDK Buffer Safety

**File:** `sdk/typescript/src/client.ts`

- Add `MAX_BUFFER_SIZE = 10000` for all buffers
- In `addSession/addSpan/addEvent`: check buffer length, drop oldest if over limit
- Replace `this.sessionBuffer.unshift(...sessions)` with `this.sessionBuffer = sessions.concat(this.sessionBuffer).slice(0, MAX_BUFFER_SIZE)`
- Add `AbortSignal.timeout(10000)` to all fetch calls
- Add `process.on('beforeExit', () => this.flush())` in constructor
- Batch healing event sends instead of one-by-one

### 3.7 Rate Limiter Hardening

**File:** `internal/server/middleware/ratelimit.go`

- Add in-memory fallback using `golang.org/x/time/rate`:
```go
if redisErr != nil {
    if !localLimiter.Allow() {
        writeRateLimited(w)
        return
    }
    next.ServeHTTP(w, r)
    return
}
```
- Add per-route-group limits in `routes.go`:
  - Ingest routes: 10,000 req/min
  - Query routes: 1,000 req/min
  - Gateway proxy: 5,000 req/min

### 3.8 Cost Recording Context Fix

**File:** `internal/route/gateway/proxy.go`

Change `recordCostEvent` to use detached context:
```go
go func() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    p.costTracker.RecordEvent(ctx, orgID, event)
}()
```

---

## Phase 4: Enterprise Hardening

### 4.1 ClickHouse Skip Indexes

**File:** `migrations/clickhouse/004_skip_indexes.up.sql` (new)

```sql
ALTER TABLE traceform.sessions ADD INDEX idx_status status TYPE set(10) GRANULARITY 4;
ALTER TABLE traceform.sessions ADD INDEX idx_agent agent_name TYPE bloom_filter(0.01) GRANULARITY 4;
ALTER TABLE traceform.spans ADD INDEX idx_span_status status TYPE set(10) GRANULARITY 4;
ALTER TABLE traceform.spans ADD INDEX idx_model model TYPE bloom_filter(0.01) GRANULARITY 4;
```

### 4.2 ZSTD Compression on Text Columns

**File:** `migrations/clickhouse/005_compression.up.sql` (new)

```sql
ALTER TABLE traceform.sessions MODIFY COLUMN input CODEC(ZSTD(3));
ALTER TABLE traceform.sessions MODIFY COLUMN output CODEC(ZSTD(3));
ALTER TABLE traceform.sessions MODIFY COLUMN metadata CODEC(ZSTD(3));
ALTER TABLE traceform.sessions MODIFY COLUMN error CODEC(ZSTD(3));
ALTER TABLE traceform.spans MODIFY COLUMN input CODEC(ZSTD(3));
ALTER TABLE traceform.spans MODIFY COLUMN output CODEC(ZSTD(3));
```

### 4.3 Daily Partitioning for High-Cardinality Tables

**File:** `migrations/clickhouse/006_daily_partitioning.up.sql` (new)

Migrate spans and events from monthly to daily partitioning:
- Create new table with `PARTITION BY toYYYYMMDD(started_at)`
- INSERT from old table
- EXCHANGE TABLES atomically
- Drop old table

### 4.4 Per-Org Configurable Retention

**Files:** `internal/worker/retention.go`, `internal/trace/store/clickhouse.go`

The retention worker already exists. Enhance it to:
- Read per-org retention days from PostgreSQL `org_settings` table (already has `retention_days` column from the enterprise optimization migration)
- For each org, DELETE from ClickHouse where `started_at < now() - INTERVAL X DAY`
- Run daily, batch deletes by org to avoid overwhelming ClickHouse

### 4.5 Worker Concurrency Configuration

**File:** `cmd/worker/main.go`, `internal/worker/ingest_writer.go`

All parameters configurable via env vars:
- `INGEST_BATCH_SIZE` (default 10000)
- `INGEST_FLUSH_INTERVAL_MS` (default 5000)
- `INGEST_MAX_BUFFER_SIZE` (default 50000)
- `INGEST_MAX_RETRIES` (default 3)
- `CH_MAX_OPEN_CONNS` (default 25)
- `CH_MAX_IDLE_CONNS` (default 15)
- `PG_MAX_OPEN_CONNS` (default 25)
- `PG_MAX_IDLE_CONNS` (default 15)

### 4.6 ClickHouse Connection Pool Sizing

**File:** `cmd/worker/main.go`

Create separate connection pools:
- Ingest pool: 25 open / 15 idle (dedicated for batch writes)
- Analytics pool: 15 open / 10 idle (for pattern matcher, alert evaluator)

Pass the appropriate pool to each component.

---

## Verification Plan

After each phase:
1. Run `go test ./... -v -count=1` — all Go tests pass
2. Run `python3 -m pytest sdk/python/tests/ -v` — all 65 SDK tests pass
3. Run `python3 test_e2e.py` — all 33 E2E tests pass
4. Browser verification of affected dashboard pages
5. Load test: simulate 1000 concurrent ingest requests and verify no OOM/panic

After Phase 4:
- Full code review against original audit findings
- Verify all 27 issues are resolved
- Stress test: 10K events/sec for 5 minutes, monitor memory/CPU/latency

---

## Files Changed Summary

| Phase | New Files | Modified Files |
|-------|-----------|---------------|
| 1 | `middleware/bodylimit.go` | `ingest_writer.go`, `routes.go`, `gateway/main.go`, `logger.go`, `docker-compose.yml` |
| 2 | `time-range-picker.tsx`, `lib/downsample.ts` | `sessions/page.tsx`, `sessions/[id]/page.tsx`, `overview/page.tsx`, `analytics/page.tsx`, `cost/page.tsx`, `sessions.go` handler, `clickhouse.go` store |
| 3 | `circuitbreaker.go` | `proxy.go`, `router.go`, `fallback.go`, `ratelimit.go`, `client.py`, `batch.py`, `healing.py`, `client.ts` |
| 4 | 3 ClickHouse migrations | `retention.go`, `worker/main.go`, `ingest_writer.go` |

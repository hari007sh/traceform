# Enterprise-Scale Data Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 enterprise-scale optimizations to Traceform: ClickHouse materialized views, hybrid adaptive sampling, payload truncation with blob storage, and TTL-based tiered retention.

**Architecture:** ClickHouse AggregatingMergeTree MVs replace on-the-fly aggregation for dashboards. SDK buffers session events and makes keep/drop sampling decisions at session end, emitting counter events for dropped sessions. Payloads >4KB are truncated inline and offloaded to content-addressed blob storage. A daily retention worker enforces per-org TTL tiers via partition drops and targeted deletes.

**Tech Stack:** Go 1.22+, ClickHouse (AggregatingMergeTree), PostgreSQL 16, NATS JetStream, Python 3.9+, TypeScript, Next.js 14

**Spec:** `docs/superpowers/specs/2026-03-25-enterprise-scale-optimization-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `migrations/clickhouse/003_materialized_views.up.sql` | 4 MV target tables + MVs, session_counters, span payload columns |
| `migrations/clickhouse/003_materialized_views.down.sql` | Drop all new tables and MVs |
| `migrations/postgres/011_sampling_retention.up.sql` | sampling_config table, org retention columns |
| `migrations/postgres/011_sampling_retention.down.sql` | Reverse |
| `internal/storage/blob.go` | BlobStore interface + FileSystemBlobStore implementation |
| `internal/storage/blob_test.go` | Unit tests for blob store |
| `internal/worker/retention_worker.go` | Daily retention enforcement: downsampling + partition drops + blob cleanup |
| `internal/worker/retention_worker_test.go` | Unit tests |
| `internal/trace/handler/payload.go` | GET /v1/spans/{id}/payload endpoint |
| `internal/trace/handler/sampling.go` | Sampling config CRUD endpoints |
| `internal/trace/service/sampling.go` | Sampling config service layer |
| `internal/trace/store/sampling_pg.go` | PostgreSQL store for sampling_config |
| `sdk/python/traceform/sampling.py` | SamplingConfig + decision logic |
| `sdk/typescript/src/sampling.ts` | TypeScript SamplingConfig + decision logic |

### Modified Files

| File | Changes |
|------|---------|
| `internal/worker/ingest_writer.go` | Add counter event handler, payload truncation + blob offload in writeSpans |
| `internal/trace/store/clickhouse.go` | Add MV-backed query methods (GetOverviewFromMV, etc.) |
| `internal/trace/service/analytics.go` | Switch to MV queries, add counter merge logic |
| `internal/trace/service/ingest.go` | Add SubjectCounterIngest, server-side sampling check |
| `internal/trace/handler/ingest.go` | Add X-Traceform-Sample-Rate header, counter extraction |
| `internal/server/routes.go` | Register payload, sampling endpoints |
| `cmd/worker/main.go` | Start retention worker |
| `cmd/migrate/main.go` | Add --backfill-views flag |
| `internal/config/config.go` | Add BlobStore and sampling config fields |
| `sdk/python/traceform/__init__.py` | Add sampling param to init() |
| `sdk/python/traceform/session.py` | Add buffer mode for sampling |
| `sdk/python/traceform/batch.py` | Add counter event type support (different from normal events) |
| `sdk/python/traceform/client.py` | Add counter events, parse X-Traceform-Sample-Rate |
| `sdk/typescript/src/session.ts` | Add buffer mode for sampling |
| `sdk/typescript/src/client.ts` | Add counter events, parse sample rate header |
| `web/app/dashboard/sessions/[id]/page.tsx` | Add "Show full payload" button for truncated spans |
| `web/app/dashboard/settings/page.tsx` | Add hot/warm/blob retention period configuration UI |
| `internal/worker/budget_checker.go` | Add adaptive sampling rate adjustment |

---

## Task 1: ClickHouse Migrations — Materialized Views + Supporting Tables

**Files:**
- Create: `migrations/clickhouse/003_materialized_views.up.sql`
- Create: `migrations/clickhouse/003_materialized_views.down.sql`

- [ ] **Step 1: Write the up migration**

Create `migrations/clickhouse/003_materialized_views.up.sql` with:

1. `mv_sessions_hourly_data` target table + `mv_sessions_hourly` MV (from sessions)
2. `mv_spans_hourly_data` target table + `mv_spans_hourly` MV (from spans)
3. `mv_healing_hourly_data` target table + `mv_healing_hourly` MV (from healing_events)
4. `mv_cost_daily_data` target table + `mv_cost_daily` MV (from spans WHERE cost_cents > 0)
5. `session_counters` table (AggregatingMergeTree, ORDER BY org_id/agent_name/status/hour)
6. ALTER TABLE spans ADD COLUMN input_truncated, output_truncated, input_hash, output_hash
7. TTL policies on all raw data tables (365-day hard ceiling)

**CRITICAL type mapping** — The existing ClickHouse tables use these types (NOT what the spec shows):
- `org_id` is `String` (not UUID) in all ClickHouse tables
- `input_tokens`, `output_tokens`, `total_tokens`, `cost_cents` are `UInt32` (not UInt64) in spans
- `healing_type` is `Enum8(...)` in healing_events — use `toString(healing_type)` in MV SELECT

All MV target table columns must match: use `org_id String`, `AggregateFunction(sum, UInt32)` for span token/cost aggregates, and `LowCardinality(String)` for healing_type (with `toString()` cast in the MV SELECT).

All MVs use explicit `TO` target tables. All aggregate columns use `sumState`/`countState`/`countIfState` combinators — no `avgState`.

- [ ] **Step 2: Write the down migration**

Create `migrations/clickhouse/003_materialized_views.down.sql`:
```sql
DROP VIEW IF EXISTS traceform.mv_sessions_hourly;
DROP TABLE IF EXISTS traceform.mv_sessions_hourly_data;
DROP VIEW IF EXISTS traceform.mv_spans_hourly;
DROP TABLE IF EXISTS traceform.mv_spans_hourly_data;
DROP VIEW IF EXISTS traceform.mv_healing_hourly;
DROP TABLE IF EXISTS traceform.mv_healing_hourly_data;
DROP VIEW IF EXISTS traceform.mv_cost_daily;
DROP TABLE IF EXISTS traceform.mv_cost_daily_data;
DROP TABLE IF EXISTS traceform.session_counters;
-- Note: Cannot easily remove columns in ClickHouse; leave payload columns
```

- [ ] **Step 3: Run the migration**

```bash
set -a && source .env && set +a && go run ./cmd/migrate/main.go
```

Verify: `curl -s 'http://localhost:8123/' -d "SHOW TABLES FROM agentstack"` — should include all new tables.

- [ ] **Step 4: Verify MVs populate on new inserts**

Run the agent simulation: `python3 scripts/real_agents.py`
Then check: `curl -s 'http://localhost:8123/' -d "SELECT countMerge(session_count) FROM traceform.mv_sessions_hourly_data"`
Expected: Non-zero count matching new sessions.

- [ ] **Step 5: Commit**

```bash
git add migrations/clickhouse/003_*
git commit -m "feat(clickhouse): add materialized views, session_counters, payload columns"
```

---

## Task 2: PostgreSQL Migration — Sampling Config + Retention Columns

**Files:**
- Create: `migrations/postgres/011_sampling_retention.up.sql`
- Create: `migrations/postgres/011_sampling_retention.down.sql`

- [ ] **Step 1: Write the up migration**

```sql
-- Sampling configuration per org/agent
CREATE TABLE sampling_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL DEFAULT '*',
    sample_rate REAL NOT NULL DEFAULT 1.0 CHECK (sample_rate >= 0.01 AND sample_rate <= 1.0),
    always_keep_errors BOOLEAN NOT NULL DEFAULT TRUE,
    always_keep_slow_ms INTEGER NOT NULL DEFAULT 5000,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, agent_name)
);

CREATE INDEX idx_sampling_config_org ON sampling_config(org_id);

-- Retention configuration on organizations
ALTER TABLE organizations
    ADD COLUMN hot_retention_days INTEGER NOT NULL DEFAULT 7,
    ADD COLUMN warm_retention_days INTEGER NOT NULL DEFAULT 90,
    ADD COLUMN blob_retention_days INTEGER NOT NULL DEFAULT 30;
```

- [ ] **Step 2: Write the down migration**

```sql
ALTER TABLE organizations
    DROP COLUMN IF EXISTS hot_retention_days,
    DROP COLUMN IF EXISTS warm_retention_days,
    DROP COLUMN IF EXISTS blob_retention_days;
DROP TABLE IF EXISTS sampling_config;
```

- [ ] **Step 3: Run migration and verify**

```bash
set -a && source .env && set +a && go run ./cmd/migrate/main.go
```

Verify (note: Docker maps PG to port 5436):
```bash
PGPASSWORD=traceform_dev psql -h localhost -p 5436 -U agentstack -d agentstack -c "\d sampling_config"
```

- [ ] **Step 4: Commit**

```bash
git add migrations/postgres/011_*
git commit -m "feat(postgres): add sampling_config table and org retention columns"
```

---

## Task 3: Config — Add Blob Store and Sampling Config Fields

**Files:**
- Modify: `internal/config/config.go`

- [ ] **Step 1: Add new config fields**

Add to the `Config` struct:
```go
// Blob Storage
BlobStoreType string // "fs" or "s3"
BlobStorePath string // filesystem path for "fs" type

// Sampling defaults
DefaultSampleRate    float64
AdaptiveThreshold    int // hourly ingest count threshold for adaptive sampling
```

Add to `Load()`:
```go
BlobStoreType:       getEnv("BLOB_STORE_TYPE", "fs"),
BlobStorePath:       getEnv("BLOB_STORE_PATH", "/tmp/traceform/payloads"),
DefaultSampleRate:   getEnvFloat("DEFAULT_SAMPLE_RATE", 1.0),
AdaptiveThreshold:   getEnvInt("ADAPTIVE_THRESHOLD", 100000),
```

Add `getEnvFloat` helper:
```go
func getEnvFloat(key string, fallback float64) float64 {
    if val := os.Getenv(key); val != "" {
        if f, err := strconv.ParseFloat(val, 64); err == nil {
            return f
        }
    }
    return fallback
}
```

- [ ] **Step 2: Add to .env file**

Append to `.env`:
```
# Blob Storage
BLOB_STORE_TYPE=fs
BLOB_STORE_PATH=/tmp/traceform/payloads

# Sampling
DEFAULT_SAMPLE_RATE=1.0
ADAPTIVE_THRESHOLD=100000
```

- [ ] **Step 3: Commit**

```bash
git add internal/config/config.go .env
git commit -m "feat(config): add blob store and sampling configuration"
```

---

## Task 4: Blob Store — Interface + FileSystem Implementation

Note: S3BlobStore is deferred to a follow-up task. FileSystemBlobStore is sufficient for self-hosted deployments and local dev.

**Files:**
- Create: `internal/storage/` directory (does not exist yet)
- Create: `internal/storage/blob.go`
- Create: `internal/storage/blob_test.go`

- [ ] **Step 1: Write the test file**

```go
// internal/storage/blob_test.go
package storage

import (
    "context"
    "os"
    "path/filepath"
    "testing"
)

func TestFileSystemBlobStore_PutGetDelete(t *testing.T) {
    dir := t.TempDir()
    store := NewFileSystemBlobStore(dir)
    ctx := context.Background()
    hash := "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
    data := []byte("hello world this is a test payload")

    // Put
    if err := store.Put(ctx, hash, data); err != nil {
        t.Fatalf("Put() error: %v", err)
    }

    // Exists
    exists, err := store.Exists(ctx, hash)
    if err != nil { t.Fatalf("Exists() error: %v", err) }
    if !exists { t.Fatal("Exists() returned false after Put") }

    // Get
    got, err := store.Get(ctx, hash)
    if err != nil { t.Fatalf("Get() error: %v", err) }
    if string(got) != string(data) { t.Fatalf("Get() = %q, want %q", got, data) }

    // Verify sharded path
    expected := filepath.Join(dir, hash[:2], hash[2:4], hash)
    if _, err := os.Stat(expected); os.IsNotExist(err) {
        t.Fatalf("File not at expected sharded path: %s", expected)
    }

    // Delete
    if err := store.Delete(ctx, hash); err != nil {
        t.Fatalf("Delete() error: %v", err)
    }

    exists, _ = store.Exists(ctx, hash)
    if exists { t.Fatal("Exists() returned true after Delete") }
}

func TestFileSystemBlobStore_PutDedup(t *testing.T) {
    dir := t.TempDir()
    store := NewFileSystemBlobStore(dir)
    ctx := context.Background()
    hash := "deadbeef12345678deadbeef12345678deadbeef12345678deadbeef12345678"
    data := []byte("dedup test")

    store.Put(ctx, hash, data)
    store.Put(ctx, hash, data) // should not error (dedup)

    got, _ := store.Get(ctx, hash)
    if string(got) != string(data) { t.Fatalf("dedup corrupted data") }
}

func TestFileSystemBlobStore_GetNotFound(t *testing.T) {
    dir := t.TempDir()
    store := NewFileSystemBlobStore(dir)
    _, err := store.Get(context.Background(), "nonexistent")
    if err == nil { t.Fatal("Get() should error for missing hash") }
}
```

- [ ] **Step 2: Run tests — should fail (no implementation)**

```bash
go test ./internal/storage/... -v -count=1
```
Expected: compilation error, `NewFileSystemBlobStore` not defined.

- [ ] **Step 3: Write the implementation**

```go
// internal/storage/blob.go
package storage

import (
    "context"
    "fmt"
    "os"
    "path/filepath"
)

// BlobStore is the interface for storing and retrieving large payloads
// by content hash (SHA-256).
type BlobStore interface {
    Put(ctx context.Context, hash string, data []byte) error
    Get(ctx context.Context, hash string) ([]byte, error)
    Delete(ctx context.Context, hash string) error
    Exists(ctx context.Context, hash string) (bool, error)
}

// FileSystemBlobStore stores blobs on the local filesystem with sharded
// directories: {base}/{hash[:2]}/{hash[2:4]}/{hash}
type FileSystemBlobStore struct {
    basePath string
}

func NewFileSystemBlobStore(basePath string) *FileSystemBlobStore {
    return &FileSystemBlobStore{basePath: basePath}
}

func (s *FileSystemBlobStore) path(hash string) string {
    if len(hash) < 4 {
        return filepath.Join(s.basePath, hash)
    }
    return filepath.Join(s.basePath, hash[:2], hash[2:4], hash)
}

func (s *FileSystemBlobStore) Put(ctx context.Context, hash string, data []byte) error {
    p := s.path(hash)
    // Dedup: skip if already exists
    if _, err := os.Stat(p); err == nil {
        return nil
    }
    if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
        return fmt.Errorf("mkdir: %w", err)
    }
    return os.WriteFile(p, data, 0644)
}

func (s *FileSystemBlobStore) Get(ctx context.Context, hash string) ([]byte, error) {
    data, err := os.ReadFile(s.path(hash))
    if err != nil {
        return nil, fmt.Errorf("blob not found: %s", hash)
    }
    return data, nil
}

func (s *FileSystemBlobStore) Delete(ctx context.Context, hash string) error {
    return os.Remove(s.path(hash))
}

func (s *FileSystemBlobStore) Exists(ctx context.Context, hash string) (bool, error) {
    _, err := os.Stat(s.path(hash))
    if os.IsNotExist(err) {
        return false, nil
    }
    return err == nil, err
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
go test ./internal/storage/... -v -count=1
```
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/storage/
git commit -m "feat(storage): add BlobStore interface and FileSystem implementation"
```

---

## Task 5: Ingest Writer — Payload Truncation + Blob Offload + Counter Handling

**Files:**
- Modify: `internal/worker/ingest_writer.go`

- [ ] **Step 1: Add blob store and counter support to IngestWriter**

Add to `IngestWriter` struct:
```go
blobStore   storage.BlobStore
counterBuf  []SessionCounter
counterSub  *nats.Subscription
```

Add `SessionCounter` struct:
```go
type SessionCounter struct {
    OrgID          string
    AgentName      string
    Status         string
    TotalTokens    uint64
    TotalCostCents uint64
    DurationMs     uint64
    SpanCount      uint32
    CreatedAt      time.Time
}
```

Update `NewIngestWriter` to accept `blobStore storage.BlobStore` parameter.

- [ ] **Step 2: Add payload truncation in writeSpans**

In `writeSpans()`, before the INSERT loop, add truncation logic for each span:

```go
const maxPayloadSize = 4096

func (w *IngestWriter) truncateAndOffload(ctx context.Context, field string, span *SpanIngestRequest) (truncated bool, hash string) {
    if len(field) <= maxPayloadSize {
        return false, ""
    }
    h := sha256.Sum256([]byte(field))
    hash = hex.EncodeToString(h[:])
    if w.blobStore != nil {
        if err := w.blobStore.Put(ctx, hash, []byte(field)); err != nil {
            w.logger.Warn("blob put failed", "error", err, "hash", hash[:16])
        }
    }
    return true, hash
}
```

Apply to both `input` and `output` fields of each span before INSERT. Set `input_truncated`/`output_truncated` and `input_hash`/`output_hash` columns accordingly. Truncate the inline value to `field[:4093] + "..."`.

- [ ] **Step 3: Add counter event handler**

Subscribe to `trace.ingest.counter` subject. Handler unmarshals `SessionCounter`, appends to `counterBuf`. Flush writes to `session_counters` table using INSERT-SELECT pattern (AggregatingMergeTree requires aggregate functions in SELECT, not VALUES):

```go
// Build a batch INSERT using a UNION ALL of single-row SELECTs
// For each counter in batch:
query := `INSERT INTO traceform.session_counters
    SELECT ?, ?, ?, toStartOfHour(?),
        countState(), sumState(toUInt64(?)), sumState(toUInt64(?)),
        sumState(toUInt64(?)), sumState(toUInt32(?))`
// Execute with parameterized values from each SessionCounter
```

Note: `countState()` with no args produces a count of 1 per row. The `toStartOfHour()` ensures bucketing matches the ORDER BY key for proper merge-tree aggregation.

- [ ] **Step 4: Update Start() to subscribe to counter subject**

Add `w.counterSub` subscription in `Start()` and clean up in `Stop()`.

- [ ] **Step 5: Test manually**

Run the worker, send a large-payload span via the simulation script, verify:
- Inline span input is truncated to ~4KB in ClickHouse
- Blob file exists at the expected path
- `input_truncated = 1` and `input_hash` is populated

```bash
curl -s 'http://localhost:8123/' -d "SELECT id, input_truncated, input_hash, length(input) FROM traceform.spans WHERE input_truncated = 1 LIMIT 5 FORMAT Pretty"
```

- [ ] **Step 6: Commit**

```bash
git add internal/worker/ingest_writer.go
git commit -m "feat(worker): add payload truncation, blob offload, and counter event handling"
```

---

## Task 6: MV-Backed Analytics Queries

**Files:**
- Modify: `internal/trace/store/clickhouse.go`
- Modify: `internal/trace/service/analytics.go`

- [ ] **Step 1: Add MV query methods to ClickHouse store**

Add to `internal/trace/store/clickhouse.go`:

```go
func (s *ClickHouseStore) GetOverviewFromMV(ctx context.Context, orgID string, start, end time.Time) (*OverviewStats, error)
```

Query `mv_sessions_hourly_data` using `countMerge()`, `sumMerge()` combinators. Compute avg_duration as `sumMerge(sum_duration_ms) / countMerge(session_count)`.

```go
func (s *ClickHouseStore) GetSessionsOverTimeFromMV(ctx context.Context, orgID string, start, end time.Time, intervalSec int) ([]TimeSeriesPoint, error)
```

Query `mv_sessions_hourly_data` grouped by hour (or re-bucket for larger intervals).

```go
func (s *ClickHouseStore) GetFailureRateFromMV(ctx context.Context, orgID string, start, end time.Time, intervalSec int) ([]FailureRatePoint, error)
```

Query `mv_sessions_hourly_data`, compute `countMerge(failed_count) / countMerge(session_count)`.

```go
func (s *ClickHouseStore) GetOverviewWithCounters(ctx context.Context, orgID string, start, end time.Time) (*OverviewStats, error)
```

FULL OUTER JOIN between `mv_sessions_hourly_data` and `session_counters` at (org_id, agent_name, hour) granularity, merging totals. This is the primary method used when sampling is active.

- [ ] **Step 2: Update analytics service to use MV methods**

In `internal/trace/service/analytics.go`, change `GetOverview()` to call `GetOverviewWithCounters()` instead of `GetOverviewStats()`. Keep the raw-table methods as fallback (called if MV tables don't exist yet).

- [ ] **Step 3: Test**

Restart the API server with env sourced. Hit the overview endpoint:
```bash
curl -s -H "Authorization: Bearer $(cat /tmp/traceform_jwt.txt)" http://localhost:8080/v1/analytics/overview | python3 -m json.tool
```

Verify response matches previous values (or is very close — MV data includes only post-migration inserts).

- [ ] **Step 4: Commit**

```bash
git add internal/trace/store/clickhouse.go internal/trace/service/analytics.go
git commit -m "feat(analytics): switch dashboard queries to materialized views"
```

---

## Task 7: Backfill Command for Existing Data

**Files:**
- Modify: `cmd/migrate/main.go`

- [ ] **Step 1: Add --backfill-views flag**

Add a `-backfill` flag to the migrate command. When set, run `INSERT INTO` for each MV target table from existing raw data:

```go
func backfillMaterializedViews(chDB *sql.DB) error {
    queries := []string{
        `INSERT INTO traceform.mv_sessions_hourly_data
         SELECT org_id, agent_name, toStartOfHour(started_at) AS hour,
            countState() AS session_count, countIfState(status = 'failed') AS failed_count,
            countIfState(status = 'healed') AS healed_count, countIfState(status = 'completed') AS completed_count,
            countIfState(status = 'timeout') AS timeout_count, sumState(total_tokens) AS total_tokens,
            sumState(total_cost_cents) AS total_cost_cents, sumState(duration_ms) AS sum_duration_ms,
            maxState(duration_ms) AS max_duration_ms, minState(duration_ms) AS min_duration_ms
         FROM traceform.sessions GROUP BY org_id, agent_name, hour`,
        // ... similar for spans, healing, cost
    }
    for _, q := range queries {
        if _, err := chDB.Exec(q); err != nil {
            return fmt.Errorf("backfill: %w", err)
        }
    }
    return nil
}
```

- [ ] **Step 2: Run backfill**

```bash
set -a && source .env && set +a && go run ./cmd/migrate/main.go -backfill
```

Verify: `curl -s 'http://localhost:8123/' -d "SELECT countMerge(session_count) FROM traceform.mv_sessions_hourly_data"` — should match total sessions count.

- [ ] **Step 3: Commit**

```bash
git add cmd/migrate/main.go
git commit -m "feat(migrate): add --backfill flag for materialized view population"
```

---

## Task 8: Sampling Config — PostgreSQL Store + Service + Handler

**Files:**
- Create: `internal/trace/store/sampling_pg.go`
- Create: `internal/trace/service/sampling.go`
- Create: `internal/trace/handler/sampling.go`
- Modify: `internal/server/routes.go`

- [ ] **Step 1: Write the PostgreSQL store**

`internal/trace/store/sampling_pg.go`:
- `GetSamplingConfig(ctx, orgID, agentName) (*SamplingConfig, error)` — query with fallback to `agent_name = '*'`
- `ListSamplingConfigs(ctx, orgID) ([]SamplingConfig, error)`
- `UpsertSamplingConfig(ctx, config) error` — INSERT ON CONFLICT UPDATE
- `DeleteSamplingConfig(ctx, id, orgID) error`

SamplingConfig struct:
```go
type SamplingConfig struct {
    ID              string  `json:"id"`
    OrgID           string  `json:"org_id"`
    AgentName       string  `json:"agent_name"`
    SampleRate      float64 `json:"sample_rate"`
    AlwaysKeepErrors bool   `json:"always_keep_errors"`
    AlwaysKeepSlowMs int    `json:"always_keep_slow_ms"`
    Enabled         bool    `json:"enabled"`
    CreatedAt       time.Time `json:"created_at"`
    UpdatedAt       time.Time `json:"updated_at"`
}
```

- [ ] **Step 2: Write the service layer**

`internal/trace/service/sampling.go`:
- `GetEffectiveConfig(ctx, orgID, agentName) (*SamplingConfig, error)` — get config with agent-specific override or org default
- `ShouldSample(ctx, orgID, agentName, status string, durationMs int) bool` — server-side sampling decision
- `List`, `Upsert`, `Delete` — thin wrappers around store

- [ ] **Step 3: Write the HTTP handler**

`internal/trace/handler/sampling.go`:
- `GET /v1/settings/sampling` → list configs for org
- `PUT /v1/settings/sampling` → upsert config (validate sample_rate 0.01-1.0)
- `DELETE /v1/settings/sampling/{id}` → delete config

- [ ] **Step 4: Register routes**

In `internal/server/routes.go`, add inside the `/v1` group:
```go
r.Route("/settings/sampling", func(r chi.Router) {
    r.Get("/", samplingHandler.List)
    r.Put("/", samplingHandler.Upsert)
    r.Delete("/{id}", samplingHandler.Delete)
})
```

- [ ] **Step 5: Test endpoints**

```bash
# Create sampling config
curl -s -X PUT -H "Authorization: Bearer $(cat /tmp/traceform_jwt.txt)" \
  -H "Content-Type: application/json" \
  http://localhost:8080/v1/settings/sampling \
  -d '{"agent_name":"*","sample_rate":0.1,"always_keep_errors":true}' | python3 -m json.tool

# List configs
curl -s -H "Authorization: Bearer $(cat /tmp/traceform_jwt.txt)" \
  http://localhost:8080/v1/settings/sampling | python3 -m json.tool
```

- [ ] **Step 6: Commit**

```bash
git add internal/trace/store/sampling_pg.go internal/trace/service/sampling.go \
  internal/trace/handler/sampling.go internal/server/routes.go
git commit -m "feat(sampling): add sampling config CRUD API"
```

---

## Task 9: Server-Side Sampling in Ingest Pipeline

**Files:**
- Modify: `internal/trace/service/ingest.go`
- Modify: `internal/trace/handler/ingest.go`

- [ ] **Step 1: Add counter subject and sampling to ingest service**

In `internal/trace/service/ingest.go`:
- Add `SubjectCounterIngest = "trace.ingest.counter"`
- Add `samplingService *SamplingService` to `IngestService`
- In `IngestBatch()`: after parsing sessions, check server-side sampling for each session. If sampled out, extract counter data and publish to counter subject instead of session/span subjects.

- [ ] **Step 2: Add X-Traceform-Sample-Rate header**

In `internal/trace/handler/ingest.go`, in `IngestBatch()`:
- Look up sampling config for the org
- Set response header: `w.Header().Set("X-Traceform-Sample-Rate", fmt.Sprintf("%.4f", config.SampleRate))`

- [ ] **Step 3: Add adaptive sampling to budget checker worker**

Modify `internal/worker/budget_checker.go`: in the periodic check loop, after budget checks,
query ClickHouse for the current hour's ingest count. If it exceeds `config.AdaptiveThreshold`,
auto-update the org's sampling_config in PostgreSQL:

```go
func (w *BudgetChecker) adjustSamplingRate(ctx context.Context, orgID string) {
    hourlyCount := queryHourlyIngestCount(ctx, orgID) // from session_counters + sessions
    if hourlyCount > w.config.AdaptiveThreshold {
        newRate := math.Max(0.01, float64(w.config.AdaptiveThreshold) / float64(hourlyCount))
        w.samplingStore.UpsertSamplingConfig(ctx, &SamplingConfig{
            OrgID: orgID, AgentName: "*", SampleRate: newRate, Enabled: true,
        })
    }
}
```

- [ ] **Step 4: Test**

Create a sampling config with rate=0.5, then ingest 20 sessions. Verify roughly half are in ClickHouse sessions table and the other half appear as counter rows.

- [ ] **Step 5: Commit**

```bash
git add internal/trace/service/ingest.go internal/trace/handler/ingest.go internal/worker/budget_checker.go
git commit -m "feat(ingest): add server-side sampling with counter events and adaptive rate"
```

---

## Task 10: Payload Fetch Endpoint

**Files:**
- Create: `internal/trace/handler/payload.go`
- Modify: `internal/server/routes.go`

- [ ] **Step 1: Write the handler**

`internal/trace/handler/payload.go`:

```go
// GET /v1/spans/{spanID}/payload?field=input|output
func (h *PayloadHandler) GetPayload(w http.ResponseWriter, r *http.Request) {
    spanID := chi.URLParam(r, "spanID")
    field := r.URL.Query().Get("field") // "input" or "output"
    orgID := middleware.GetOrgID(r.Context())

    // Query ClickHouse for the hash
    hashCol := field + "_hash"
    var hash string
    // SELECT {hashCol} FROM traceform.spans WHERE id = ? AND org_id = ?
    // If hash is empty, return the inline data
    // If hash exists, fetch from blob store
    data, err := h.blobStore.Get(r.Context(), hash)
    // Return as application/json
}
```

- [ ] **Step 2: Register route**

In `routes.go`: `r.Get("/v1/spans/{spanID}/payload", payloadHandler.GetPayload)`

- [ ] **Step 3: Test**

After running simulation with large payloads, fetch a truncated span's full payload:
```bash
SPAN_ID=$(curl -s 'http://localhost:8123/' -d "SELECT id FROM traceform.spans WHERE input_truncated = 1 LIMIT 1" | tr -d '\n')
curl -s -H "Authorization: Bearer $(cat /tmp/traceform_jwt.txt)" \
  "http://localhost:8080/v1/spans/$SPAN_ID/payload?field=input"
```

- [ ] **Step 4: Commit**

```bash
git add internal/trace/handler/payload.go internal/server/routes.go
git commit -m "feat(api): add payload fetch endpoint for truncated spans"
```

---

## Task 11: Retention Worker

**Files:**
- Create: `internal/worker/retention_worker.go`
- Modify: `cmd/worker/main.go`

- [ ] **Step 1: Write the retention worker**

`internal/worker/retention_worker.go`:

```go
type RetentionWorker struct {
    chDB      *sql.DB
    pgDB      *sql.DB
    blobStore storage.BlobStore
    logger    *slog.Logger
    interval  time.Duration // default: 24h
    done      chan struct{}
}

func (w *RetentionWorker) Start()
func (w *RetentionWorker) Stop()
func (w *RetentionWorker) run() // ticker loop
func (w *RetentionWorker) enforce(ctx context.Context) error
func (w *RetentionWorker) downsampleWarmSessions(ctx, orgID, hotDays, warmDays) error
func (w *RetentionWorker) cleanupBlobs(ctx, orgID, blobDays) error
func (w *RetentionWorker) dropExpiredPartitions(ctx, orgID, warmDays) error
```

`enforce()` iterates all orgs from PostgreSQL, reads their retention config, and runs downsampling + cleanup for each.

- [ ] **Step 2: Register in worker main**

In `cmd/worker/main.go`, add:
```go
retentionWorker := worker.NewRetentionWorker(chDB, pgDB, blobStore, logger, 24*time.Hour)
retentionWorker.Start()
// ... in shutdown: retentionWorker.Stop()
```

- [ ] **Step 3: Write retention worker unit tests**

Create `internal/worker/retention_worker_test.go`:
- `TestDownsampleWarmSessions`: Insert 100 completed + 10 failed sessions with old timestamps, run downsampler, verify ~10 completed remain + all 10 failed remain.
- `TestBlobCleanup`: Create blob refs for expired spans, run cleanup, verify blobs deleted. Create blob refs for non-expired spans, verify blobs preserved.
- `TestDropExpiredPartitions`: Verify partition drop SQL is generated correctly for fully-expired months.

```bash
go test ./internal/worker/ -run TestRetention -v -count=1
```

- [ ] **Step 4: Test manually with short retention**

Temporarily set an org's hot_retention_days=0, warm_retention_days=1. Run the retention worker manually. Verify successful sessions are downsampled (90% deleted) while failed sessions remain.

- [ ] **Step 5: Commit**

```bash
git add internal/worker/retention_worker.go internal/worker/retention_worker_test.go cmd/worker/main.go
git commit -m "feat(worker): add daily retention worker for TTL enforcement"
```

---

*(Task 12 merged into Task 1 — TTL policies are part of the initial ClickHouse migration)*

---

## Task 13: Python SDK — Sampling Support

**Files:**
- Create: `sdk/python/traceform/sampling.py`
- Modify: `sdk/python/traceform/__init__.py`
- Modify: `sdk/python/traceform/session.py`
- Modify: `sdk/python/traceform/client.py`

- [ ] **Step 1: Create sampling.py**

```python
import random
from dataclasses import dataclass, field

@dataclass
class SamplingConfig:
    rate: float = 1.0
    always_keep_errors: bool = True
    always_keep_slow_ms: int = 5000
    always_keep_costly: int = 500  # cents

    def should_send_full(self, status, duration_ms, total_cost_cents):
        if self.rate >= 1.0:
            return True
        if self.always_keep_errors and status in ('failed', 'healed', 'timeout'):
            return True
        if duration_ms and duration_ms > self.always_keep_slow_ms:
            return True
        if total_cost_cents > self.always_keep_costly:
            return True
        return random.random() < self.rate
```

- [ ] **Step 2: Add buffer mode to Session**

In `sdk/python/traceform/session.py`:
- Add `_sampling_config` and `_buffer` to `__init__`
- When `sampling_config.rate < 1.0`: buffer events in `_buffer` list instead of calling `client.send_event()`
- In `end()`: call `should_send_full()`. If True: flush buffer to client. If False: send counter event only.
- Buffer cap: 1000 events. If exceeded, drop oldest with warning.

- [ ] **Step 3: Add counter event to Client**

In `sdk/python/traceform/client.py`:
- Add `send_counter(agent_name, status, tokens, cost, duration, spans)` method
- Parse `X-Traceform-Sample-Rate` from batch response headers and update sampling config

- [ ] **Step 3b: Add counter event type to BatchSender**

In `sdk/python/traceform/batch.py`: the `_send_batch()` method currently classifies events by type. Add handling for `session_counter` type events — these should be sent to a separate `/v1/ingest/counters` path (or included in the batch payload under a `counters` key). The batch sender should recognize counter events and route them correctly.

- [ ] **Step 3c: Write unit tests for sampling**

Create `sdk/python/tests/test_sampling.py`:
```python
def test_always_keep_errors():
    config = SamplingConfig(rate=0.0)  # Drop everything
    assert config.should_send_full('failed', 1000, 10) == True
    assert config.should_send_full('healed', 1000, 10) == True
    assert config.should_send_full('timeout', 1000, 10) == True

def test_always_keep_slow():
    config = SamplingConfig(rate=0.0, always_keep_slow_ms=5000)
    assert config.should_send_full('completed', 6000, 10) == True
    assert config.should_send_full('completed', 4000, 10) == False

def test_always_keep_costly():
    config = SamplingConfig(rate=0.0, always_keep_costly=500)
    assert config.should_send_full('completed', 1000, 600) == True
    assert config.should_send_full('completed', 1000, 400) == False

def test_probabilistic_rate():
    config = SamplingConfig(rate=0.5)
    results = [config.should_send_full('completed', 1000, 10) for _ in range(1000)]
    kept = sum(results)
    assert 350 < kept < 650  # ~50% with reasonable variance

def test_buffer_cap():
    # Verify session buffer doesn't exceed 1000 events
    ...
```

Run: `cd sdk/python && python -m pytest tests/test_sampling.py -v`

- [ ] **Step 4: Add sampling param to init()**

In `sdk/python/traceform/__init__.py`:
```python
def init(api_key, endpoint=..., sampling=None, ...):
    global _sampling_config
    if sampling:
        _sampling_config = sampling
```

Pass `_sampling_config` to `Session()` constructor.

- [ ] **Step 5: Test**

```python
import traceform
from traceform.sampling import SamplingConfig

traceform.init(
    api_key="tf_sk_test123",
    endpoint="http://localhost:8080",
    sampling=SamplingConfig(rate=0.1)
)

# Run 20 sessions — expect ~2 fully sent, ~18 as counters
for i in range(20):
    with traceform.session(agent_name="sampling-test") as s:
        with s.span("test", span_type="llm_call") as sp:
            sp.set_tokens(100, 50)
            sp.set_cost(5)

traceform.flush()
traceform.shutdown()
```

Verify in ClickHouse: ~2 sessions + ~18 counter entries.

- [ ] **Step 6: Commit**

```bash
git add sdk/python/traceform/sampling.py sdk/python/traceform/__init__.py \
  sdk/python/traceform/session.py sdk/python/traceform/client.py
git commit -m "feat(sdk-python): add hybrid sampling with counter events"
```

---

## Task 14: TypeScript SDK — Sampling Support

**Files:**
- Create: `sdk/typescript/src/sampling.ts`
- Modify: `sdk/typescript/src/session.ts`
- Modify: `sdk/typescript/src/client.ts`

- [ ] **Step 1: Create sampling.ts**

Mirror the Python SamplingConfig as a TypeScript interface + class with `shouldSendFull()` method.

- [ ] **Step 2: Add buffer mode to SessionInstance**

Same logic as Python: buffer events when sampling rate < 1.0, flush or counter at `end()`.

- [ ] **Step 3: Add counter event to TraceformClient**

Add `sendCounter()` method and X-Traceform-Sample-Rate header parsing.

- [ ] **Step 4: Commit**

```bash
git add sdk/typescript/src/sampling.ts sdk/typescript/src/session.ts sdk/typescript/src/client.ts
git commit -m "feat(sdk-typescript): add hybrid sampling with counter events"
```

---

## Task 15: Dashboard — Show Full Payload Button

**Files:**
- Modify: `web/app/dashboard/sessions/[id]/page.tsx`

- [ ] **Step 1: Add payload fetch function**

```typescript
async function fetchFullPayload(spanId: string, field: 'input' | 'output'): Promise<string> {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/v1/spans/${spanId}/payload?field=${field}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Payload not available');
    return res.text();
}
```

- [ ] **Step 2: Add "Show full" button to span detail**

In the span rendering section, check for `input_truncated` flag:

```tsx
{span.input_truncated ? (
    <div>
        <pre>{span.input}</pre>
        <Button variant="ghost" size="sm" onClick={async () => {
            const full = await fetchFullPayload(span.id, 'input');
            setExpandedPayloads(prev => ({...prev, [`${span.id}-input`]: full}));
        }}>
            Show full input
        </Button>
        {expandedPayloads[`${span.id}-input`] && (
            <pre className="mt-2 max-h-96 overflow-auto">{expandedPayloads[`${span.id}-input`]}</pre>
        )}
    </div>
) : (
    <pre>{span.input}</pre>
)}
```

Same pattern for output.

- [ ] **Step 3: Test in browser**

Navigate to a session detail page with truncated spans. Verify the "Show full input" button appears and loads the full payload on click.

- [ ] **Step 4: Commit**

```bash
git add web/app/dashboard/sessions/\[id\]/page.tsx
git commit -m "feat(dashboard): add lazy-load full payload button for truncated spans"
```

---

## Task 16: Settings Page — Retention Period Configuration

**Files:**
- Modify: `web/app/dashboard/settings/page.tsx`

- [ ] **Step 1: Add retention period controls**

In the existing "Preferences" section (which already has timezone and retention dropdown), update the retention dropdown to save to the new org columns (`hot_retention_days`, `warm_retention_days`, `blob_retention_days`). Add separate controls for hot/warm/blob if the current single dropdown is insufficient.

The settings page already makes API calls to `PUT /v1/settings` — extend the settings API to accept and persist the retention fields.

- [ ] **Step 2: Test**

Navigate to Settings in the browser, change retention period, save. Verify the org's retention columns are updated in PostgreSQL.

- [ ] **Step 3: Commit**

```bash
git add web/app/dashboard/settings/page.tsx
git commit -m "feat(dashboard): add retention period configuration to settings page"
```

---

## Task 17: Integration Test — End-to-End Verification

**Files:**
- Create: `scripts/test_optimizations.py`

- [ ] **Step 1: Write E2E verification script**

Script that:
1. Verifies MVs exist and populate on new inserts
2. Tests sampling: ingest 50 sessions with rate=0.1, verify ~5 full + ~45 counters
3. Tests payload truncation: send a span with 10KB input, verify truncated + blob stored
4. Tests payload fetch: GET /v1/spans/{id}/payload returns full 10KB
5. Tests MV+counter merge: verify dashboard overview numbers include both sampled and counter data
6. Tests sampling config API: CRUD operations

- [ ] **Step 2: Run it**

```bash
python3 scripts/test_optimizations.py
```

- [ ] **Step 3: Verify dashboard**

Open http://localhost:3000/dashboard/overview in Chrome and verify all metrics are populated correctly.

- [ ] **Step 4: Commit**

```bash
git add scripts/test_optimizations.py
git commit -m "test: add E2E verification for enterprise-scale optimizations"
```

---

## Dependency Graph

```
Task 1 (CH migrations+TTL) ──┐
Task 2 (PG migrations) ───┐  │
Task 3 (Config) ───────┐  │  │
                        │  │  │
Task 4 (Blob Store) ───┤  │  │
                        │  │  │
Task 5 (Ingest Writer) ←──┴──┘  (depends on 1, 2, 3, 4)
Task 6 (MV Queries) ←───────────(depends on 1)
Task 7 (Backfill) ←──────────── (depends on 1, 6)
Task 8 (Sampling API) ←──────── (depends on 2)
Task 9 (Server Sampling) ←───── (depends on 5, 8)
Task 10 (Payload Fetch) ←────── (depends on 4, 5)
Task 11 (Retention Worker) ←─── (depends on 2, 4)
Task 13 (Python SDK) ←───────── (depends on 9)
Task 14 (TS SDK) ←────────────  (depends on 9)
Task 15 (Dashboard Payload) ←── (depends on 10)
Task 16 (Settings Page) ←────── (depends on 2)
Task 17 (E2E Test) ←─────────── (depends on all)
```

Parallelizable groups:
- **Wave 1:** Tasks 1, 2, 3, 4 (all independent)
- **Wave 2:** Tasks 5, 6, 8, 11, 16 (depend on Wave 1)
- **Wave 3:** Tasks 7, 9, 10 (depend on Wave 2)
- **Wave 4:** Tasks 13, 14, 15 (depend on Wave 3)
- **Wave 5:** Task 17 (depends on all)

-- ============================================================
-- 003_materialized_views.up.sql
-- Materialized views for pre-aggregated analytics,
-- session_counters table, payload columns, and TTL policies.
-- ============================================================

-- -------------------------------------------------------
-- 1. mv_sessions_hourly: hourly session aggregates
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS traceform.mv_sessions_hourly_data (
    org_id String,
    agent_name LowCardinality(String),
    hour DateTime,
    session_count AggregateFunction(count),
    failed_count AggregateFunction(countIf, UInt8),
    healed_count AggregateFunction(countIf, UInt8),
    completed_count AggregateFunction(countIf, UInt8),
    timeout_count AggregateFunction(countIf, UInt8),
    sum_tokens AggregateFunction(sum, UInt64),
    sum_cost_cents AggregateFunction(sum, UInt64),
    sum_duration_ms AggregateFunction(sum, UInt64),
    max_duration_ms AggregateFunction(max, UInt64),
    min_duration_ms AggregateFunction(min, UInt64)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (org_id, hour, agent_name);

CREATE MATERIALIZED VIEW IF NOT EXISTS traceform.mv_sessions_hourly
TO traceform.mv_sessions_hourly_data
AS SELECT
    org_id,
    agent_name,
    toStartOfHour(started_at) AS hour,
    countState() AS session_count,
    countIfState(status = 'failed') AS failed_count,
    countIfState(status = 'healed') AS healed_count,
    countIfState(status = 'completed') AS completed_count,
    countIfState(status = 'timeout') AS timeout_count,
    sumState(total_tokens) AS sum_tokens,
    sumState(total_cost_cents) AS sum_cost_cents,
    sumState(duration_ms) AS sum_duration_ms,
    maxState(duration_ms) AS max_duration_ms,
    minState(duration_ms) AS min_duration_ms
FROM traceform.sessions
GROUP BY org_id, agent_name, hour;

-- -------------------------------------------------------
-- 2. mv_spans_hourly: hourly span aggregates
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS traceform.mv_spans_hourly_data (
    org_id String,
    model LowCardinality(String),
    provider LowCardinality(String),
    span_type LowCardinality(String),
    hour DateTime,
    span_count AggregateFunction(count),
    failed_count AggregateFunction(countIf, UInt8),
    sum_input_tokens AggregateFunction(sum, UInt32),
    sum_output_tokens AggregateFunction(sum, UInt32),
    sum_total_tokens AggregateFunction(sum, UInt32),
    sum_cost_cents AggregateFunction(sum, UInt32),
    sum_duration_ms AggregateFunction(sum, UInt64),
    max_duration_ms AggregateFunction(max, UInt64)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (org_id, hour, model, provider);

CREATE MATERIALIZED VIEW IF NOT EXISTS traceform.mv_spans_hourly
TO traceform.mv_spans_hourly_data
AS SELECT
    org_id,
    model,
    provider,
    toString(span_type) AS span_type,
    toStartOfHour(started_at) AS hour,
    countState() AS span_count,
    countIfState(status = 'failed') AS failed_count,
    sumState(input_tokens) AS sum_input_tokens,
    sumState(output_tokens) AS sum_output_tokens,
    sumState(total_tokens) AS sum_total_tokens,
    sumState(cost_cents) AS sum_cost_cents,
    sumState(duration_ms) AS sum_duration_ms,
    maxState(duration_ms) AS max_duration_ms
FROM traceform.spans
GROUP BY org_id, model, provider, span_type, hour;

-- -------------------------------------------------------
-- 3. mv_healing_hourly: hourly healing event aggregates
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS traceform.mv_healing_hourly_data (
    org_id String,
    healing_type LowCardinality(String),
    hour DateTime,
    total_count AggregateFunction(count),
    success_count AggregateFunction(countIf, UInt8),
    sum_latency_ms AggregateFunction(sum, UInt32)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (org_id, hour, healing_type);

CREATE MATERIALIZED VIEW IF NOT EXISTS traceform.mv_healing_hourly
TO traceform.mv_healing_hourly_data
AS SELECT
    org_id,
    toString(healing_type) AS healing_type,
    toStartOfHour(created_at) AS hour,
    countState() AS total_count,
    countIfState(success = 1) AS success_count,
    sumState(latency_ms) AS sum_latency_ms
FROM traceform.healing_events
GROUP BY org_id, healing_type, hour;

-- -------------------------------------------------------
-- 4. mv_cost_daily: daily cost aggregates from spans
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS traceform.mv_cost_daily_data (
    org_id String,
    model LowCardinality(String),
    provider LowCardinality(String),
    day Date,
    span_count AggregateFunction(count),
    sum_input_tokens AggregateFunction(sum, UInt32),
    sum_output_tokens AggregateFunction(sum, UInt32),
    sum_cost_cents AggregateFunction(sum, UInt32),
    avg_cost_cents AggregateFunction(avg, UInt32)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (org_id, day, model, provider);

CREATE MATERIALIZED VIEW IF NOT EXISTS traceform.mv_cost_daily
TO traceform.mv_cost_daily_data
AS SELECT
    org_id,
    model,
    provider,
    toDate(started_at) AS day,
    countState() AS span_count,
    sumState(input_tokens) AS sum_input_tokens,
    sumState(output_tokens) AS sum_output_tokens,
    sumState(cost_cents) AS sum_cost_cents,
    avgState(cost_cents) AS avg_cost_cents
FROM traceform.spans
WHERE cost_cents > 0
GROUP BY org_id, model, provider, day;

-- -------------------------------------------------------
-- 5. session_counters: pre-aggregated session metrics
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS traceform.session_counters (
    org_id String,
    agent_name LowCardinality(String),
    status LowCardinality(String),
    hour DateTime,
    session_count AggregateFunction(count),
    sum_tokens AggregateFunction(sum, UInt64),
    sum_cost_cents AggregateFunction(sum, UInt64),
    sum_duration_ms AggregateFunction(sum, UInt64),
    sum_span_count AggregateFunction(sum, UInt32)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (org_id, agent_name, status, hour);

-- -------------------------------------------------------
-- 6. Payload columns on spans table
-- -------------------------------------------------------
ALTER TABLE traceform.spans ADD COLUMN IF NOT EXISTS input_truncated UInt8 DEFAULT 0;
ALTER TABLE traceform.spans ADD COLUMN IF NOT EXISTS output_truncated UInt8 DEFAULT 0;
ALTER TABLE traceform.spans ADD COLUMN IF NOT EXISTS input_hash String DEFAULT '';
ALTER TABLE traceform.spans ADD COLUMN IF NOT EXISTS output_hash String DEFAULT '';

-- -------------------------------------------------------
-- 7. TTL policies (365-day hard ceiling)
-- -------------------------------------------------------
ALTER TABLE traceform.sessions MODIFY TTL started_at + INTERVAL 365 DAY DELETE;
ALTER TABLE traceform.spans MODIFY TTL started_at + INTERVAL 365 DAY DELETE;
ALTER TABLE traceform.events MODIFY TTL created_at + INTERVAL 365 DAY DELETE;
ALTER TABLE traceform.healing_events MODIFY TTL created_at + INTERVAL 365 DAY DELETE;
ALTER TABLE traceform.gateway_requests MODIFY TTL created_at + INTERVAL 365 DAY DELETE;

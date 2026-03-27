-- ============================================================
-- 007_optimized_views.up.sql
-- Additional optimized materialized views for cost rollups
-- and error aggregation that are not covered by 003.
-- ============================================================

-- -------------------------------------------------------
-- 1. mv_cost_hourly: hourly cost rollup by model
--    Enables fast cost analytics queries without scanning
--    the full spans table.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS traceform.mv_cost_hourly_data (
    org_id String,
    model LowCardinality(String),
    hour DateTime,
    total_cost_cents AggregateFunction(sum, UInt32),
    total_input_tokens AggregateFunction(sum, UInt32),
    total_output_tokens AggregateFunction(sum, UInt32),
    request_count AggregateFunction(count)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (org_id, model, hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS traceform.mv_cost_hourly
TO traceform.mv_cost_hourly_data
AS SELECT
    org_id,
    model,
    toStartOfHour(started_at) AS hour,
    sumState(cost_cents) AS total_cost_cents,
    sumState(input_tokens) AS total_input_tokens,
    sumState(output_tokens) AS total_output_tokens,
    countState() AS request_count
FROM traceform.spans
WHERE cost_cents > 0
GROUP BY org_id, model, hour;

-- -------------------------------------------------------
-- 2. mv_errors_daily: daily error rollup by fingerprint
--    Enables fast error group queries and trending without
--    scanning the full sessions table.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS traceform.mv_errors_daily_data (
    org_id String,
    error_fingerprint String,
    day Date,
    error_count AggregateFunction(count),
    sample_error AggregateFunction(any, String),
    sample_agent AggregateFunction(any, String)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (org_id, error_fingerprint, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS traceform.mv_errors_daily
TO traceform.mv_errors_daily_data
AS SELECT
    org_id,
    error_fingerprint,
    toDate(started_at) AS day,
    countState() AS error_count,
    anyState(error) AS sample_error,
    anyState(agent_name) AS sample_agent
FROM traceform.sessions
WHERE status = 'failed' AND error_fingerprint != ''
GROUP BY org_id, error_fingerprint, day;

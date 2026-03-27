-- ============================================================
-- 003_materialized_views.down.sql
-- Drop materialized views FIRST (before their target tables),
-- then drop target tables and session_counters.
-- Payload columns (ADD COLUMN) cannot be easily removed in
-- ClickHouse so they are left in place.
-- TTL policies are also left in place (no harm in keeping them).
-- ============================================================

-- Drop materialized views first
DROP VIEW IF EXISTS traceform.mv_sessions_hourly;
DROP VIEW IF EXISTS traceform.mv_spans_hourly;
DROP VIEW IF EXISTS traceform.mv_healing_hourly;
DROP VIEW IF EXISTS traceform.mv_cost_daily;

-- Drop target tables
DROP TABLE IF EXISTS traceform.mv_sessions_hourly_data;
DROP TABLE IF EXISTS traceform.mv_spans_hourly_data;
DROP TABLE IF EXISTS traceform.mv_healing_hourly_data;
DROP TABLE IF EXISTS traceform.mv_cost_daily_data;

-- Drop session_counters
DROP TABLE IF EXISTS traceform.session_counters;

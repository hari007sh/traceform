-- ============================================================
-- 007_optimized_views.down.sql
-- Reverse the optimized materialized views.
-- ============================================================

DROP VIEW IF EXISTS traceform.mv_cost_hourly;
DROP TABLE IF EXISTS traceform.mv_cost_hourly_data;

DROP VIEW IF EXISTS traceform.mv_errors_daily;
DROP TABLE IF EXISTS traceform.mv_errors_daily_data;

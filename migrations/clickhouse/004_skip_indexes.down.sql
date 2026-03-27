ALTER TABLE traceform.sessions DROP INDEX IF EXISTS idx_status;
ALTER TABLE traceform.sessions DROP INDEX IF EXISTS idx_agent;
ALTER TABLE traceform.spans DROP INDEX IF EXISTS idx_span_status;
ALTER TABLE traceform.spans DROP INDEX IF EXISTS idx_model;
ALTER TABLE traceform.spans DROP INDEX IF EXISTS idx_span_type;

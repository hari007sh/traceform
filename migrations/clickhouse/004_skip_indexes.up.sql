ALTER TABLE traceform.sessions ADD INDEX idx_status status TYPE set(10) GRANULARITY 4;
ALTER TABLE traceform.sessions ADD INDEX idx_agent agent_name TYPE bloom_filter(0.01) GRANULARITY 4;
ALTER TABLE traceform.spans ADD INDEX idx_span_status status TYPE set(10) GRANULARITY 4;
ALTER TABLE traceform.spans ADD INDEX idx_model model TYPE bloom_filter(0.01) GRANULARITY 4;
ALTER TABLE traceform.spans ADD INDEX idx_span_type span_type TYPE set(10) GRANULARITY 4;

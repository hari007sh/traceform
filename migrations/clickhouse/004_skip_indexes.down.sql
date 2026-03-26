ALTER TABLE agentstack.sessions DROP INDEX IF EXISTS idx_status;
ALTER TABLE agentstack.sessions DROP INDEX IF EXISTS idx_agent;
ALTER TABLE agentstack.spans DROP INDEX IF EXISTS idx_span_status;
ALTER TABLE agentstack.spans DROP INDEX IF EXISTS idx_model;
ALTER TABLE agentstack.spans DROP INDEX IF EXISTS idx_span_type;

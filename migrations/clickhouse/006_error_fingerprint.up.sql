ALTER TABLE agentstack.sessions ADD COLUMN IF NOT EXISTS error_fingerprint String DEFAULT '' AFTER error;

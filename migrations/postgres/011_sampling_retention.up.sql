-- Sampling configuration per org/agent
CREATE TABLE sampling_configs (
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

CREATE INDEX idx_sampling_configs_org ON sampling_configs(org_id);

-- Retention configuration on organizations
ALTER TABLE organizations
    ADD COLUMN hot_retention_days INTEGER NOT NULL DEFAULT 7,
    ADD COLUMN warm_retention_days INTEGER NOT NULL DEFAULT 90,
    ADD COLUMN blob_retention_days INTEGER NOT NULL DEFAULT 30;

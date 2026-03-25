ALTER TABLE organizations
    DROP COLUMN IF EXISTS hot_retention_days,
    DROP COLUMN IF EXISTS warm_retention_days,
    DROP COLUMN IF EXISTS blob_retention_days;
DROP TABLE IF EXISTS sampling_config;

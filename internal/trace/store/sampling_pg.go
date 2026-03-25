package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// SamplingConfig represents a sampling configuration for an agent or wildcard.
type SamplingConfig struct {
	ID               string    `json:"id"`
	OrgID            string    `json:"org_id"`
	AgentName        string    `json:"agent_name"`
	SampleRate       float64   `json:"sample_rate"`
	AlwaysKeepErrors bool      `json:"always_keep_errors"`
	AlwaysKeepSlowMs int       `json:"always_keep_slow_ms"`
	Enabled          bool      `json:"enabled"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// SamplingPGStore provides CRUD access to sampling configuration in PostgreSQL.
type SamplingPGStore struct {
	db *sql.DB
}

// NewSamplingPGStore creates a new sampling config PostgreSQL store.
func NewSamplingPGStore(db *sql.DB) *SamplingPGStore {
	return &SamplingPGStore{db: db}
}

// GetSamplingConfig returns the sampling config for a specific agent, falling back
// to the wildcard ('*') config if no agent-specific config exists.
func (s *SamplingPGStore) GetSamplingConfig(ctx context.Context, orgID, agentName string) (*SamplingConfig, error) {
	query := `SELECT id, org_id, agent_name, sample_rate, always_keep_errors,
	                 always_keep_slow_ms, enabled, created_at, updated_at
	          FROM sampling_configs
	          WHERE org_id = $1 AND agent_name = $2`

	var cfg SamplingConfig
	err := s.db.QueryRowContext(ctx, query, orgID, agentName).Scan(
		&cfg.ID, &cfg.OrgID, &cfg.AgentName, &cfg.SampleRate,
		&cfg.AlwaysKeepErrors, &cfg.AlwaysKeepSlowMs, &cfg.Enabled,
		&cfg.CreatedAt, &cfg.UpdatedAt,
	)
	if err == nil {
		return &cfg, nil
	}
	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("get sampling config: %w", err)
	}

	// Fallback to wildcard config
	if agentName != "*" {
		err = s.db.QueryRowContext(ctx, query, orgID, "*").Scan(
			&cfg.ID, &cfg.OrgID, &cfg.AgentName, &cfg.SampleRate,
			&cfg.AlwaysKeepErrors, &cfg.AlwaysKeepSlowMs, &cfg.Enabled,
			&cfg.CreatedAt, &cfg.UpdatedAt,
		)
		if err == nil {
			return &cfg, nil
		}
		if err != sql.ErrNoRows {
			return nil, fmt.Errorf("get sampling config wildcard: %w", err)
		}
	}

	return nil, nil
}

// ListSamplingConfigs returns all sampling configs for an organization.
func (s *SamplingPGStore) ListSamplingConfigs(ctx context.Context, orgID string) ([]SamplingConfig, error) {
	query := `SELECT id, org_id, agent_name, sample_rate, always_keep_errors,
	                 always_keep_slow_ms, enabled, created_at, updated_at
	          FROM sampling_configs
	          WHERE org_id = $1
	          ORDER BY created_at DESC`

	rows, err := s.db.QueryContext(ctx, query, orgID)
	if err != nil {
		return nil, fmt.Errorf("list sampling configs: %w", err)
	}
	defer rows.Close()

	var configs []SamplingConfig
	for rows.Next() {
		var cfg SamplingConfig
		if err := rows.Scan(
			&cfg.ID, &cfg.OrgID, &cfg.AgentName, &cfg.SampleRate,
			&cfg.AlwaysKeepErrors, &cfg.AlwaysKeepSlowMs, &cfg.Enabled,
			&cfg.CreatedAt, &cfg.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan sampling config: %w", err)
		}
		configs = append(configs, cfg)
	}
	if configs == nil {
		configs = []SamplingConfig{}
	}
	return configs, rows.Err()
}

// UpsertSamplingConfig inserts a new sampling config or updates an existing one
// based on the (org_id, agent_name) unique constraint.
func (s *SamplingPGStore) UpsertSamplingConfig(ctx context.Context, cfg *SamplingConfig) error {
	query := `INSERT INTO sampling_configs (org_id, agent_name, sample_rate, always_keep_errors,
	          always_keep_slow_ms, enabled)
	          VALUES ($1, $2, $3, $4, $5, $6)
	          ON CONFLICT (org_id, agent_name) DO UPDATE SET
	            sample_rate = EXCLUDED.sample_rate,
	            always_keep_errors = EXCLUDED.always_keep_errors,
	            always_keep_slow_ms = EXCLUDED.always_keep_slow_ms,
	            enabled = EXCLUDED.enabled,
	            updated_at = NOW()
	          RETURNING id, created_at, updated_at`

	return s.db.QueryRowContext(ctx, query,
		cfg.OrgID, cfg.AgentName, cfg.SampleRate,
		cfg.AlwaysKeepErrors, cfg.AlwaysKeepSlowMs, cfg.Enabled,
	).Scan(&cfg.ID, &cfg.CreatedAt, &cfg.UpdatedAt)
}

// DeleteSamplingConfig removes a sampling config by ID with org ownership check.
func (s *SamplingPGStore) DeleteSamplingConfig(ctx context.Context, id, orgID string) error {
	query := `DELETE FROM sampling_configs WHERE id = $1 AND org_id = $2`
	result, err := s.db.ExecContext(ctx, query, id, orgID)
	if err != nil {
		return fmt.Errorf("delete sampling config: %w", err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

package service

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand"

	"github.com/traceform/traceform/internal/trace/store"
)

// SamplingService provides business logic for sampling configuration.
type SamplingService struct {
	store  *store.SamplingPGStore
	logger *slog.Logger
}

// NewSamplingService creates a new sampling service.
func NewSamplingService(store *store.SamplingPGStore, logger *slog.Logger) *SamplingService {
	return &SamplingService{store: store, logger: logger}
}

// defaultSamplingConfig returns a default sampling config used when no config
// is found for the org/agent.
func defaultSamplingConfig() *store.SamplingConfig {
	return &store.SamplingConfig{
		AgentName:        "*",
		SampleRate:       1.0,
		AlwaysKeepErrors: true,
		AlwaysKeepSlowMs: 0,
		Enabled:          true,
	}
}

// GetEffectiveConfig returns the effective sampling config for an agent.
// It tries agent-specific first, then wildcard, then returns a sensible default.
func (s *SamplingService) GetEffectiveConfig(ctx context.Context, orgID, agentName string) (*store.SamplingConfig, error) {
	cfg, err := s.store.GetSamplingConfig(ctx, orgID, agentName)
	if err != nil {
		return nil, fmt.Errorf("get effective sampling config: %w", err)
	}
	if cfg != nil {
		return cfg, nil
	}
	// Return default when nothing is configured
	return defaultSamplingConfig(), nil
}

// ShouldSample determines whether a trace should be sampled based on the config,
// span status, and duration.
func (s *SamplingService) ShouldSample(cfg *store.SamplingConfig, status string, durationMs int64) bool {
	if cfg == nil || !cfg.Enabled {
		return true // if no config or disabled, sample everything
	}

	// Always keep errors if configured
	if cfg.AlwaysKeepErrors && (status == "error" || status == "failed") {
		return true
	}

	// Always keep slow traces if configured
	if cfg.AlwaysKeepSlowMs > 0 && durationMs >= int64(cfg.AlwaysKeepSlowMs) {
		return true
	}

	// Probabilistic sampling based on sample_rate
	if cfg.SampleRate >= 1.0 {
		return true
	}
	if cfg.SampleRate <= 0.0 {
		return false
	}

	return rand.Float64() < cfg.SampleRate
}

// List returns all sampling configs for an organization.
func (s *SamplingService) List(ctx context.Context, orgID string) ([]store.SamplingConfig, error) {
	return s.store.ListSamplingConfigs(ctx, orgID)
}

// Upsert validates and upserts a sampling config.
func (s *SamplingService) Upsert(ctx context.Context, cfg *store.SamplingConfig) error {
	if cfg.AgentName == "" {
		return fmt.Errorf("agent_name is required")
	}
	if cfg.SampleRate < 0.01 || cfg.SampleRate > 1.0 {
		return fmt.Errorf("sample_rate must be between 0.01 and 1.0")
	}
	if cfg.AlwaysKeepSlowMs < 0 {
		return fmt.Errorf("always_keep_slow_ms must be non-negative")
	}

	return s.store.UpsertSamplingConfig(ctx, cfg)
}

// Delete removes a sampling config by ID with org ownership check.
func (s *SamplingService) Delete(ctx context.Context, id, orgID string) error {
	return s.store.DeleteSamplingConfig(ctx, id, orgID)
}

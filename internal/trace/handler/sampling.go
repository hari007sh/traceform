package handler

import (
	"database/sql"
	"log/slog"
	"net/http"

	"github.com/traceform/traceform/internal/server/httputil"
	"github.com/traceform/traceform/internal/server/middleware"
	"github.com/traceform/traceform/internal/trace/service"
	"github.com/traceform/traceform/internal/trace/store"
	"github.com/go-chi/chi/v5"
)

// SamplingHandler handles sampling configuration CRUD endpoints.
type SamplingHandler struct {
	svc    *service.SamplingService
	logger *slog.Logger
}

// NewSamplingHandler creates a new sampling handler.
func NewSamplingHandler(svc *service.SamplingService, logger *slog.Logger) *SamplingHandler {
	return &SamplingHandler{svc: svc, logger: logger}
}

// upsertSamplingRequest is the request body for upserting a sampling config.
type upsertSamplingRequest struct {
	AgentName        string   `json:"agent_name"`
	SampleRate       *float64 `json:"sample_rate"`
	AlwaysKeepErrors *bool    `json:"always_keep_errors,omitempty"`
	AlwaysKeepSlowMs *int     `json:"always_keep_slow_ms,omitempty"`
	Enabled          *bool    `json:"enabled,omitempty"`
}

// List handles GET /v1/settings/sampling.
func (h *SamplingHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		httputil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	configs, err := h.svc.List(r.Context(), orgID)
	if err != nil {
		h.logger.Error("failed to list sampling configs", "org_id", orgID, "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "QUERY_ERROR", "failed to list sampling configs")
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"configs": configs,
	})
}

// Upsert handles PUT /v1/settings/sampling.
func (h *SamplingHandler) Upsert(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		httputil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	var req upsertSamplingRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "INVALID_BODY", "invalid JSON request body")
		return
	}

	if req.AgentName == "" {
		httputil.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "agent_name is required")
		return
	}
	if req.SampleRate == nil {
		httputil.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "sample_rate is required")
		return
	}
	if *req.SampleRate < 0.01 || *req.SampleRate > 1.0 {
		httputil.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "sample_rate must be between 0.01 and 1.0")
		return
	}

	// Defaults
	alwaysKeepErrors := true
	if req.AlwaysKeepErrors != nil {
		alwaysKeepErrors = *req.AlwaysKeepErrors
	}

	alwaysKeepSlowMs := 0
	if req.AlwaysKeepSlowMs != nil {
		if *req.AlwaysKeepSlowMs < 0 {
			httputil.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "always_keep_slow_ms must be non-negative")
			return
		}
		alwaysKeepSlowMs = *req.AlwaysKeepSlowMs
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	cfg := &store.SamplingConfig{
		OrgID:            orgID,
		AgentName:        req.AgentName,
		SampleRate:       *req.SampleRate,
		AlwaysKeepErrors: alwaysKeepErrors,
		AlwaysKeepSlowMs: alwaysKeepSlowMs,
		Enabled:          enabled,
	}

	if err := h.svc.Upsert(r.Context(), cfg); err != nil {
		h.logger.Error("failed to upsert sampling config", "org_id", orgID, "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "UPSERT_ERROR", "failed to upsert sampling config")
		return
	}

	h.logger.Info("upserted sampling config", "id", cfg.ID, "agent_name", cfg.AgentName, "org_id", orgID)
	httputil.WriteJSON(w, http.StatusOK, cfg)
}

// Delete handles DELETE /v1/settings/sampling/{id}.
func (h *SamplingHandler) Delete(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		httputil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	id := chi.URLParam(r, "id")
	if id == "" {
		httputil.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "sampling config ID is required")
		return
	}

	if err := h.svc.Delete(r.Context(), id, orgID); err != nil {
		if err == sql.ErrNoRows {
			httputil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "sampling config not found")
			return
		}
		h.logger.Error("failed to delete sampling config", "id", id, "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "DELETE_ERROR", "failed to delete sampling config")
		return
	}

	h.logger.Info("deleted sampling config", "id", id, "org_id", orgID)
	w.WriteHeader(http.StatusNoContent)
}

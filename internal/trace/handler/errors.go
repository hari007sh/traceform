package handler

import (
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/agentstack/agentstack/internal/server/httputil"
	"github.com/agentstack/agentstack/internal/server/middleware"
	"github.com/agentstack/agentstack/internal/trace/store"
	"github.com/go-chi/chi/v5"
)

// ErrorsHandler handles error group endpoints.
type ErrorsHandler struct {
	ch     *store.ClickHouseStore
	logger *slog.Logger
}

// NewErrorsHandler creates a new errors handler.
func NewErrorsHandler(ch *store.ClickHouseStore, logger *slog.Logger) *ErrorsHandler {
	return &ErrorsHandler{ch: ch, logger: logger}
}

// ListGroups handles GET /v1/errors — returns error groups aggregated by fingerprint.
func (h *ErrorsHandler) ListGroups(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		httputil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	start, end := parseErrorTimeRange(r)

	groups, err := h.ch.ListErrorGroups(r.Context(), orgID, start, end)
	if err != nil {
		h.logger.Error("failed to list error groups", "org_id", orgID, "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "QUERY_ERROR", "failed to list error groups")
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"groups": groups,
		"start":  start.Format(time.RFC3339),
		"end":    end.Format(time.RFC3339),
	})
}

// GetGroup handles GET /v1/errors/{fingerprint} — returns sessions for a specific error group.
func (h *ErrorsHandler) GetGroup(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		httputil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	fingerprint := chi.URLParam(r, "fingerprint")
	if fingerprint == "" {
		httputil.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "fingerprint is required")
		return
	}

	start, end := parseErrorTimeRange(r)

	limit := 50
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	sessions, total, err := h.ch.GetErrorGroupSessions(r.Context(), orgID, fingerprint, start, end, limit, offset)
	if err != nil {
		h.logger.Error("failed to get error group sessions", "fingerprint", fingerprint, "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "QUERY_ERROR", "failed to get error group sessions")
		return
	}

	perPage := limit
	page := 1
	if offset > 0 && perPage > 0 {
		page = (offset / perPage) + 1
	}
	totalPages := int(math.Ceil(float64(total) / float64(perPage)))
	if totalPages < 1 {
		totalPages = 1
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"fingerprint": fingerprint,
		"sessions":    sessions,
		"total":       total,
		"meta": map[string]interface{}{
			"page":        page,
			"per_page":    perPage,
			"total":       total,
			"total_pages": totalPages,
		},
	})
}

// parseErrorTimeRange extracts start and end times from query parameters.
// Defaults to the last 7 days for error groups.
func parseErrorTimeRange(r *http.Request) (time.Time, time.Time) {
	q := r.URL.Query()
	now := time.Now().UTC()

	end := now
	start := now.Add(-7 * 24 * time.Hour)

	if v := q.Get("start"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			start = t
		}
	}
	if v := q.Get("end"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			end = t
		}
	}

	return start, end
}

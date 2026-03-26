package audit

import (
	"log/slog"
	"math"
	"net/http"
	"strconv"

	"github.com/agentstack/agentstack/internal/server/httputil"
	"github.com/agentstack/agentstack/internal/server/middleware"
)

// Handler provides HTTP handlers for the audit log API.
type Handler struct {
	store  *Store
	logger *slog.Logger
}

// NewHandler creates a new audit log handler.
func NewHandler(store *Store, logger *slog.Logger) *Handler {
	return &Handler{store: store, logger: logger}
}

// List handles GET /api/audit-logs and returns a paginated list of audit log entries.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		httputil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	// Parse pagination params
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if perPage < 1 {
		perPage = 50
	}

	// Parse optional filters
	filters := ListFilters{
		UserID:       r.URL.Query().Get("user_id"),
		Action:       r.URL.Query().Get("action"),
		ResourceType: r.URL.Query().Get("resource_type"),
	}

	result, err := h.store.List(r.Context(), orgID, page, perPage, filters)
	if err != nil {
		h.logger.Error("failed to list audit logs", "error", err, "org_id", orgID)
		httputil.WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to list audit logs")
		return
	}

	totalPages := int(math.Ceil(float64(result.Total) / float64(result.PerPage)))

	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"data": result.Entries,
		"meta": map[string]interface{}{
			"page":        result.Page,
			"per_page":    result.PerPage,
			"total":       result.Total,
			"total_pages": totalPages,
		},
	})
}

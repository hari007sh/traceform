package handler

import (
	"database/sql"
	"log/slog"
	"net/http"

	"github.com/traceform/traceform/internal/server/httputil"
	"github.com/traceform/traceform/internal/server/middleware"
	"github.com/traceform/traceform/internal/storage"
	"github.com/go-chi/chi/v5"
)

// PayloadHandler serves full payloads for truncated span fields.
type PayloadHandler struct {
	chDB      *sql.DB
	blobStore storage.BlobStore
	logger    *slog.Logger
}

// NewPayloadHandler creates a new PayloadHandler.
func NewPayloadHandler(chDB *sql.DB, blobStore storage.BlobStore, logger *slog.Logger) *PayloadHandler {
	return &PayloadHandler{chDB: chDB, blobStore: blobStore, logger: logger}
}

// GetPayload returns the full payload for a truncated span field.
// GET /v1/spans/{spanID}/payload?field=input|output
func (h *PayloadHandler) GetPayload(w http.ResponseWriter, r *http.Request) {
	spanID := chi.URLParam(r, "spanID")
	field := r.URL.Query().Get("field")
	orgID := middleware.GetOrgID(r.Context())

	if orgID == "" {
		httputil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	if field != "input" && field != "output" {
		httputil.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "field must be 'input' or 'output'")
		return
	}

	// Query ClickHouse for the hash and inline data.
	hashCol := field + "_hash"
	truncatedCol := field + "_truncated"
	var hash string
	var truncated uint8
	var inlineData string

	query := "SELECT " + hashCol + ", " + truncatedCol + ", " + field + " FROM traceform.spans WHERE id = ? AND org_id = ? LIMIT 1"
	row := h.chDB.QueryRowContext(r.Context(), query, spanID, orgID)
	if err := row.Scan(&hash, &truncated, &inlineData); err != nil {
		if err == sql.ErrNoRows {
			httputil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "span not found")
		} else {
			h.logger.Error("query span payload", "error", err)
			httputil.WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "query failed")
		}
		return
	}

	// If not truncated, return inline data.
	if truncated == 0 || hash == "" {
		httputil.WriteJSON(w, http.StatusOK, map[string]string{
			"payload": inlineData,
			"source":  "inline",
		})
		return
	}

	// Fetch from blob store.
	data, err := h.blobStore.Get(r.Context(), hash)
	if err != nil {
		h.logger.Warn("blob fetch failed, falling back to inline", "hash", hash[:min(16, len(hash))], "error", err)
		// Return inline data as fallback.
		httputil.WriteJSON(w, http.StatusOK, map[string]string{
			"payload": inlineData,
			"source":  "inline",
			"note":    "full payload expired",
		})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]string{
		"payload": string(data),
		"source":  "blob",
		"hash":    hash,
	})
}

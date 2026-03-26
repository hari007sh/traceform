package server

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/agentstack/agentstack/internal/audit"
	coststore "github.com/agentstack/agentstack/internal/cost/store"
	"github.com/agentstack/agentstack/internal/server/middleware"
	"github.com/agentstack/agentstack/internal/trace/store"
)

// exportParams holds the parsed query parameters common to all export endpoints.
type exportParams struct {
	Format  string
	Start   time.Time
	End     time.Time
	PerPage int
}

// parseExportParams validates and parses common export query parameters.
func parseExportParams(r *http.Request) (*exportParams, string, string) {
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "csv"
	}
	if format != "csv" && format != "json" {
		return nil, "INVALID_FORMAT", "format must be 'csv' or 'json'"
	}

	perPage := 10000
	if pp := r.URL.Query().Get("per_page"); pp != "" {
		val, err := strconv.Atoi(pp)
		if err != nil || val < 1 {
			return nil, "INVALID_PER_PAGE", "per_page must be a positive integer"
		}
		if val > 100000 {
			val = 100000
		}
		perPage = val
	}

	startStr := r.URL.Query().Get("start")
	endStr := r.URL.Query().Get("end")

	var start, end time.Time
	if startStr != "" {
		t, err := time.Parse(time.RFC3339, startStr)
		if err != nil {
			// Try date-only format
			t, err = time.Parse("2006-01-02", startStr)
			if err != nil {
				return nil, "INVALID_START", "start must be RFC3339 or YYYY-MM-DD format"
			}
		}
		start = t
	} else {
		// Default: 30 days ago
		start = time.Now().UTC().AddDate(0, 0, -30)
	}

	if endStr != "" {
		t, err := time.Parse(time.RFC3339, endStr)
		if err != nil {
			t, err = time.Parse("2006-01-02", endStr)
			if err != nil {
				return nil, "INVALID_END", "end must be RFC3339 or YYYY-MM-DD format"
			}
			// If date-only, set to end of day
			t = t.Add(23*time.Hour + 59*time.Minute + 59*time.Second)
		}
		end = t
	} else {
		end = time.Now().UTC()
	}

	return &exportParams{
		Format:  format,
		Start:   start,
		End:     end,
		PerPage: perPage,
	}, "", ""
}

// handleExportSessions exports session data as CSV or JSON.
func (s *Server) handleExportSessions(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	params, code, msg := parseExportParams(r)
	if params == nil {
		WriteError(w, http.StatusBadRequest, code, msg)
		return
	}

	if s.clickhouseDB == nil {
		WriteError(w, http.StatusServiceUnavailable, "CLICKHOUSE_UNAVAILABLE", "ClickHouse is not configured")
		return
	}

	chStore := store.NewClickHouseStore(s.clickhouseDB)
	filter := store.SessionFilter{
		StartDate: &params.Start,
		EndDate:   &params.End,
		Limit:     params.PerPage,
		Offset:    0,
	}
	filter.Normalize()
	// Override the limit clamping from Normalize() for export
	filter.Limit = params.PerPage

	sessions, _, err := chStore.ListSessions(r.Context(), orgID, filter)
	if err != nil {
		s.logger.Error("failed to export sessions", "error", err, "org_id", orgID)
		WriteError(w, http.StatusInternalServerError, "EXPORT_ERROR", "failed to query sessions for export")
		return
	}

	s.auditLogger.Log(r, "exported", "sessions", "", map[string]interface{}{
		"format": params.Format,
		"count":  len(sessions),
	})

	if params.Format == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=sessions.csv")

		writer := csv.NewWriter(w)
		// Write header
		writer.Write([]string{
			"id", "agent_name", "status", "duration_ms",
			"total_tokens", "total_cost_cents", "total_spans",
			"has_healing", "started_at", "ended_at",
		})

		for _, sess := range sessions {
			writer.Write([]string{
				sess.ID,
				sess.AgentName,
				sess.Status,
				strconv.FormatUint(sess.DurationMs, 10),
				strconv.FormatUint(sess.TotalTokens, 10),
				strconv.FormatUint(sess.TotalCostCents, 10),
				strconv.FormatUint(uint64(sess.TotalSpans), 10),
				strconv.FormatBool(sess.HasHealing),
				sess.StartedAt.Format(time.RFC3339),
				sess.EndedAt.Format(time.RFC3339),
			})
		}
		writer.Flush()

		if err := writer.Error(); err != nil {
			s.logger.Error("csv flush error during session export", "error", err)
		}
		return
	}

	// JSON format
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=sessions.json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sessions": sessions,
		"count":    len(sessions),
	})
}

// handleExportCostEvents exports cost event data as CSV or JSON.
func (s *Server) handleExportCostEvents(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	params, code, msg := parseExportParams(r)
	if params == nil {
		WriteError(w, http.StatusBadRequest, code, msg)
		return
	}

	pgStore := coststore.NewPostgresStore(s.db)
	filter := coststore.CostEventFilter{
		From:   params.Start,
		To:     params.End,
		Limit:  params.PerPage,
		Offset: 0,
	}

	events, _, err := pgStore.ListCostEvents(r.Context(), orgID, filter)
	if err != nil {
		s.logger.Error("failed to export cost events", "error", err, "org_id", orgID)
		WriteError(w, http.StatusInternalServerError, "EXPORT_ERROR", "failed to query cost events for export")
		return
	}

	s.auditLogger.Log(r, "exported", "cost_events", "", map[string]interface{}{
		"format": params.Format,
		"count":  len(events),
	})

	if params.Format == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=cost_events.csv")

		writer := csv.NewWriter(w)
		writer.Write([]string{
			"id", "session_id", "span_id", "agent_name", "model", "provider",
			"input_tokens", "output_tokens", "total_tokens", "cost_cents",
			"outcome", "created_at",
		})

		for _, e := range events {
			writer.Write([]string{
				e.ID,
				e.SessionID,
				e.SpanID,
				e.AgentName,
				e.Model,
				e.Provider,
				strconv.Itoa(e.InputTokens),
				strconv.Itoa(e.OutputTokens),
				strconv.Itoa(e.TotalTokens),
				strconv.Itoa(e.CostCents),
				e.Outcome,
				e.CreatedAt.Format(time.RFC3339),
			})
		}
		writer.Flush()

		if err := writer.Error(); err != nil {
			s.logger.Error("csv flush error during cost export", "error", err)
		}
		return
	}

	// JSON format
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=cost_events.json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"cost_events": events,
		"count":       len(events),
	})
}

// handleExportAuditLogs exports audit log data as CSV or JSON.
func (s *Server) handleExportAuditLogs(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	params, code, msg := parseExportParams(r)
	if params == nil {
		WriteError(w, http.StatusBadRequest, code, msg)
		return
	}

	auditStore := audit.NewStore(s.db)

	// Audit store uses page-based pagination; calculate total pages needed
	perPage := params.PerPage
	if perPage > 100 {
		// The audit store clamps to 100 per page internally, so we page through
		perPage = 100
	}

	result, err := auditStore.List(r.Context(), orgID, 1, perPage, audit.ListFilters{})
	if err != nil {
		s.logger.Error("failed to export audit logs", "error", err, "org_id", orgID)
		WriteError(w, http.StatusInternalServerError, "EXPORT_ERROR", "failed to query audit logs for export")
		return
	}

	// If more pages needed and per_page was > 100, collect remaining pages
	allEntries := result.Entries
	if params.PerPage > 100 && result.TotalPgs > 1 {
		remaining := params.PerPage - len(allEntries)
		for page := 2; page <= result.TotalPgs && remaining > 0; page++ {
			pageResult, err := auditStore.List(r.Context(), orgID, page, 100, audit.ListFilters{})
			if err != nil {
				break
			}
			allEntries = append(allEntries, pageResult.Entries...)
			remaining -= len(pageResult.Entries)
		}
	}

	// Trim to requested per_page
	if len(allEntries) > params.PerPage {
		allEntries = allEntries[:params.PerPage]
	}

	s.auditLogger.Log(r, "exported", "audit_logs", "", map[string]interface{}{
		"format": params.Format,
		"count":  len(allEntries),
	})

	if params.Format == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=audit_logs.csv")

		writer := csv.NewWriter(w)
		writer.Write([]string{
			"id", "user_id", "user_email", "action",
			"resource_type", "resource_id", "ip_address",
			"user_agent", "created_at",
		})

		for _, e := range allEntries {
			writer.Write([]string{
				e.ID,
				e.UserID,
				e.UserEmail,
				e.Action,
				e.ResourceType,
				e.ResourceID,
				e.IPAddress,
				e.UserAgent,
				e.CreatedAt.Format(time.RFC3339),
			})
		}
		writer.Flush()

		if err := writer.Error(); err != nil {
			s.logger.Error("csv flush error during audit export", "error", err)
		}
		return
	}

	// JSON format
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=audit_logs.json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"audit_logs": allEntries,
		"count":      len(allEntries),
	})
}

// handleExportFormat is a convenience endpoint that describes available export formats.
func (s *Server) handleExportFormats(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]interface{}{
		"formats": []string{"csv", "json"},
		"endpoints": []map[string]string{
			{"path": "/v1/export/sessions", "description": "Export session data"},
			{"path": "/v1/export/cost", "description": "Export cost event data"},
			{"path": "/v1/export/audit", "description": "Export audit log data"},
		},
		"parameters": map[string]string{
			"format":   "csv (default) or json",
			"start":    "Start date (RFC3339 or YYYY-MM-DD). Default: 30 days ago",
			"end":      "End date (RFC3339 or YYYY-MM-DD). Default: now",
			"per_page": "Max rows to return (default 10000, max 100000)",
		},
	})
}

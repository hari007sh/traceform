package server

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/agentstack/agentstack/internal/server/middleware"
)

// gdprDeleteResponse is the JSON response for the full org data deletion endpoint.
type gdprDeleteResponse struct {
	Status     string            `json:"status"`
	OrgID      string            `json:"org_id"`
	Clickhouse map[string]string `json:"clickhouse"`
	Postgres   map[string]int64  `json:"postgres"`
	DeletedAt  string            `json:"deleted_at"`
}

// gdprSessionDeleteResponse is the JSON response for partial session deletion.
type gdprSessionDeleteResponse struct {
	Status     string            `json:"status"`
	OrgID      string            `json:"org_id"`
	Before     string            `json:"before"`
	Clickhouse map[string]string `json:"clickhouse"`
	DeletedAt  string            `json:"deleted_at"`
}

// handleDeleteOrgData deletes ALL data for the organization from both ClickHouse
// and PostgreSQL. This is the GDPR "right to erasure" endpoint. Owner only.
//
// ClickHouse tables use ALTER TABLE DELETE (async mutations).
// PostgreSQL tables that cascade from organizations are handled by deleting from
// the org-scoped tables that lack a foreign key to organizations. Tables with
// ON DELETE CASCADE are cleaned up when the org itself is deleted via the
// existing handleDeleteOrg endpoint.
func (s *Server) handleDeleteOrgData(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()

	resp := gdprDeleteResponse{
		Status:     "completed",
		OrgID:      orgID,
		Clickhouse: make(map[string]string),
		Postgres:   make(map[string]int64),
		DeletedAt:  time.Now().UTC().Format(time.RFC3339),
	}

	// --- ClickHouse deletion (async mutations) ---
	if s.clickhouseDB != nil {
		chTables := []string{"sessions", "spans", "events", "healing_events", "gateway_requests"}
		for _, table := range chTables {
			query := fmt.Sprintf("ALTER TABLE agentstack.%s DELETE WHERE org_id = ?", table)
			_, err := s.clickhouseDB.ExecContext(ctx, query, orgID)
			if err != nil {
				s.logger.Error("GDPR: failed to delete from ClickHouse table",
					"table", table, "org_id", orgID, "error", err)
				resp.Clickhouse[table] = fmt.Sprintf("error: %v", err)
			} else {
				resp.Clickhouse[table] = "mutation_submitted"
			}
		}
	} else {
		resp.Clickhouse["status"] = "clickhouse_not_configured"
	}

	// --- PostgreSQL deletion ---
	// Tables that DO NOT have ON DELETE CASCADE from organizations and need
	// explicit deletion. Order matters: delete child tables first.
	pgDeletions := []struct {
		name  string
		query string
	}{
		// Webhook deliveries cascade from endpoints, but endpoints have no FK to orgs
		{"webhook_deliveries", "DELETE FROM webhook_deliveries WHERE org_id = $1"},
		{"webhook_endpoints", "DELETE FROM webhook_endpoints WHERE org_id = $1"},
		// Prompt versions cascade from prompts, but prompts have no FK to orgs
		{"prompts", "DELETE FROM prompts WHERE org_id = $1"},
		// Dataset items and links cascade from datasets, but datasets have no FK to orgs
		{"datasets", "DELETE FROM datasets WHERE org_id = $1"},
		// Tables WITH ON DELETE CASCADE — explicitly delete for count reporting.
		// These would be cleaned up if the org row is deleted, but the user may
		// want to purge data while keeping the org account active.
		{"cost_events", "DELETE FROM cost_events WHERE org_id = $1"},
		{"test_run_results", "DELETE FROM test_run_results WHERE run_id IN (SELECT id FROM test_runs WHERE org_id = $1)"},
		{"test_runs", "DELETE FROM test_runs WHERE org_id = $1"},
		{"test_cases", "DELETE FROM test_cases WHERE org_id = $1"},
		{"test_suites", "DELETE FROM test_suites WHERE org_id = $1"},
		{"guard_events", "DELETE FROM guard_events WHERE org_id = $1"},
		{"guardrails", "DELETE FROM guardrails WHERE org_id = $1"},
		{"gateway_requests", "DELETE FROM gateway_requests WHERE org_id = $1"},
		{"alert_events", "DELETE FROM alert_events WHERE org_id = $1"},
		{"alert_rules", "DELETE FROM alert_rules WHERE org_id = $1"},
		{"failure_patterns", "DELETE FROM failure_patterns WHERE org_id = $1"},
		{"agents", "DELETE FROM agents WHERE org_id = $1"},
		{"budgets", "DELETE FROM budgets WHERE org_id = $1"},
		{"audit_logs", "DELETE FROM audit_logs WHERE org_id = $1"},
	}

	for _, d := range pgDeletions {
		result, err := s.db.ExecContext(ctx, d.query, orgID)
		if err != nil {
			s.logger.Error("GDPR: failed to delete from PostgreSQL table",
				"table", d.name, "org_id", orgID, "error", err)
			resp.Postgres[d.name] = -1
			continue
		}
		rows, _ := result.RowsAffected()
		resp.Postgres[d.name] = rows
	}

	s.logger.Info("GDPR: org data deletion completed",
		"org_id", orgID,
		"postgres_tables", len(pgDeletions),
	)

	// Log the audit event (best-effort; audit_logs were just deleted but this
	// creates a new record documenting the deletion action itself).
	if s.auditLogger != nil {
		s.auditLogger.Log(r, "gdpr_delete", "organization", orgID, map[string]interface{}{
			"action": "full_data_deletion",
		})
	}

	WriteJSON(w, http.StatusOK, resp)
}

// handleDeleteOrgSessions deletes sessions (and related spans/events) older
// than a given date. This supports incremental GDPR cleanup.
//
// Query parameter: before (ISO 8601 date, required)
// Example: DELETE /api/org/data/sessions?before=2025-01-01T00:00:00Z
func (s *Server) handleDeleteOrgSessions(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	beforeStr := r.URL.Query().Get("before")
	if beforeStr == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_PARAM", "query parameter 'before' is required (ISO 8601 date)")
		return
	}

	before, err := time.Parse(time.RFC3339, beforeStr)
	if err != nil {
		// Try date-only format
		before, err = time.Parse("2006-01-02", beforeStr)
		if err != nil {
			WriteError(w, http.StatusBadRequest, "INVALID_DATE", "before must be RFC3339 or YYYY-MM-DD format")
			return
		}
	}

	if before.After(time.Now()) {
		WriteError(w, http.StatusBadRequest, "INVALID_DATE", "before date must be in the past")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()

	resp := gdprSessionDeleteResponse{
		Status:     "completed",
		OrgID:      orgID,
		Before:     before.UTC().Format(time.RFC3339),
		Clickhouse: make(map[string]string),
		DeletedAt:  time.Now().UTC().Format(time.RFC3339),
	}

	if s.clickhouseDB == nil {
		WriteError(w, http.StatusServiceUnavailable, "CLICKHOUSE_UNAVAILABLE", "ClickHouse is not configured")
		return
	}

	// Delete spans for sessions before the cutoff date
	chDeletions := []struct {
		name  string
		query string
	}{
		{"spans", "ALTER TABLE agentstack.spans DELETE WHERE org_id = ? AND started_at < ?"},
		{"events", "ALTER TABLE agentstack.events DELETE WHERE org_id = ? AND timestamp < ?"},
		{"sessions", "ALTER TABLE agentstack.sessions DELETE WHERE org_id = ? AND started_at < ?"},
		{"healing_events", "ALTER TABLE agentstack.healing_events DELETE WHERE org_id = ? AND created_at < ?"},
	}

	for _, d := range chDeletions {
		_, err := s.clickhouseDB.ExecContext(ctx, d.query, orgID, before)
		if err != nil {
			s.logger.Error("GDPR: failed to delete old data from ClickHouse",
				"table", d.name, "org_id", orgID, "before", before, "error", err)
			resp.Clickhouse[d.name] = fmt.Sprintf("error: %v", err)
		} else {
			resp.Clickhouse[d.name] = "mutation_submitted"
		}
	}

	s.logger.Info("GDPR: partial session deletion completed",
		"org_id", orgID,
		"before", before.Format(time.RFC3339),
	)

	if s.auditLogger != nil {
		s.auditLogger.Log(r, "gdpr_delete", "sessions", "", map[string]interface{}{
			"action": "partial_session_deletion",
			"before": before.Format(time.RFC3339),
		})
	}

	WriteJSON(w, http.StatusOK, resp)
}

// deleteFromPG is a helper that executes a DELETE query and returns rows affected.
// It is used internally but exported helpers exist at package level for testing.
func deleteFromPG(ctx context.Context, db *sql.DB, query string, args ...interface{}) (int64, error) {
	result, err := db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// Package audit provides the audit logging service for tracking security-relevant
// mutations such as API key creation, team member changes, and configuration updates.
package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
)

// Store provides PostgreSQL CRUD access to the audit_logs table.
type Store struct {
	db *sql.DB
}

// NewStore creates a new audit log store.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// Entry represents a single audit log row.
type Entry struct {
	ID           string          `json:"id"`
	OrgID        string          `json:"org_id"`
	UserID       string          `json:"user_id"`
	UserEmail    string          `json:"user_email"`
	Action       string          `json:"action"`
	ResourceType string          `json:"resource_type"`
	ResourceID   string          `json:"resource_id"`
	Details      json.RawMessage `json:"details"`
	IPAddress    string          `json:"ip_address"`
	UserAgent    string          `json:"user_agent"`
	CreatedAt    time.Time       `json:"created_at"`
}

// ListFilters holds optional filters for listing audit logs.
type ListFilters struct {
	UserID       string
	Action       string
	ResourceType string
}

// ListResult is the paginated result of listing audit logs.
type ListResult struct {
	Entries  []Entry `json:"data"`
	Total    int     `json:"total"`
	Page     int     `json:"page"`
	PerPage  int     `json:"per_page"`
	TotalPgs int     `json:"total_pages"`
}

// Insert writes a single audit log entry to the database.
func (s *Store) Insert(ctx context.Context, e Entry) error {
	if e.Details == nil {
		e.Details = json.RawMessage(`{}`)
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO audit_logs (org_id, user_id, user_email, action, resource_type, resource_id, details, ip_address, user_agent)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		e.OrgID, e.UserID, e.UserEmail, e.Action, e.ResourceType, e.ResourceID, e.Details, e.IPAddress, e.UserAgent,
	)
	return err
}

// List returns a paginated, optionally filtered list of audit log entries for an org.
func (s *Store) List(ctx context.Context, orgID string, page, perPage int, filters ListFilters) (*ListResult, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 50
	}
	if perPage > 100 {
		perPage = 100
	}

	// Build WHERE clause dynamically
	where := []string{"org_id = $1"}
	args := []interface{}{orgID}
	argIdx := 2

	if filters.UserID != "" {
		where = append(where, fmt.Sprintf("user_id = $%d", argIdx))
		args = append(args, filters.UserID)
		argIdx++
	}
	if filters.Action != "" {
		where = append(where, fmt.Sprintf("action = $%d", argIdx))
		args = append(args, filters.Action)
		argIdx++
	}
	if filters.ResourceType != "" {
		where = append(where, fmt.Sprintf("resource_type = $%d", argIdx))
		args = append(args, filters.ResourceType)
		argIdx++
	}

	whereClause := strings.Join(where, " AND ")

	// Count total matching rows
	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM audit_logs WHERE %s", whereClause)
	if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count audit_logs: %w", err)
	}

	// Fetch page of results
	offset := (page - 1) * perPage
	dataQuery := fmt.Sprintf(
		`SELECT id, org_id, user_id, user_email, action, resource_type, resource_id, details, ip_address, user_agent, created_at
		 FROM audit_logs
		 WHERE %s
		 ORDER BY created_at DESC
		 LIMIT $%d OFFSET $%d`,
		whereClause, argIdx, argIdx+1,
	)
	args = append(args, perPage, offset)

	rows, err := s.db.QueryContext(ctx, dataQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("list audit_logs: %w", err)
	}
	defer rows.Close()

	entries := make([]Entry, 0)
	for rows.Next() {
		var e Entry
		if err := rows.Scan(
			&e.ID, &e.OrgID, &e.UserID, &e.UserEmail, &e.Action,
			&e.ResourceType, &e.ResourceID, &e.Details, &e.IPAddress,
			&e.UserAgent, &e.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan audit_log row: %w", err)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate audit_log rows: %w", err)
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))

	return &ListResult{
		Entries:  entries,
		Total:    total,
		Page:     page,
		PerPage:  perPage,
		TotalPgs: totalPages,
	}, nil
}

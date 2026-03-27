package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// ClickHouseStore provides read access to trace data stored in ClickHouse.
type ClickHouseStore struct {
	db *sql.DB
}

// NewClickHouseStore creates a new ClickHouse store.
func NewClickHouseStore(db *sql.DB) *ClickHouseStore {
	return &ClickHouseStore{db: db}
}

// --- Data types ---

// Session represents a trace session stored in ClickHouse.
type Session struct {
	ID               string    `json:"id"`
	OrgID            string    `json:"org_id"`
	AgentName        string    `json:"agent_name"`
	AgentID          string    `json:"agent_id"`
	Status           string    `json:"status"`
	Input            string    `json:"input"`
	Output           string    `json:"output"`
	Error            string    `json:"error,omitempty"`
	ErrorFingerprint string    `json:"error_fingerprint,omitempty"`
	Metadata         string    `json:"metadata"`
	TotalTokens      uint64    `json:"total_tokens"`
	TotalCostCents   uint64    `json:"total_cost_cents"`
	TotalSpans       uint32    `json:"total_spans"`
	DurationMs       uint64    `json:"duration_ms"`
	HasHealing       bool      `json:"has_healing"`
	Tags             []string  `json:"tags"`
	StartedAt        time.Time `json:"started_at"`
	EndedAt          time.Time `json:"ended_at"`
	CreatedAt        time.Time `json:"created_at"`
}

// Span represents a trace span stored in ClickHouse.
type Span struct {
	ID           string    `json:"id"`
	SessionID    string    `json:"session_id"`
	OrgID        string    `json:"org_id"`
	ParentID     string    `json:"parent_id,omitempty"`
	Name         string    `json:"name"`
	SpanType     string    `json:"span_type"`
	Status       string    `json:"status"`
	Input        string    `json:"input"`
	Output       string    `json:"output"`
	Error        string    `json:"error,omitempty"`
	Model        string    `json:"model,omitempty"`
	Provider     string    `json:"provider,omitempty"`
	InputTokens  uint32    `json:"input_tokens"`
	OutputTokens uint32    `json:"output_tokens"`
	TotalTokens  uint32    `json:"total_tokens"`
	CostCents    uint32    `json:"cost_cents"`
	DurationMs   uint64    `json:"duration_ms"`
	Metadata     string    `json:"metadata"`
	StartedAt    time.Time `json:"started_at"`
	EndedAt      time.Time `json:"ended_at"`
	CreatedAt    time.Time `json:"created_at"`
}

// Event represents a trace event stored in ClickHouse.
type Event struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	SpanID    string    `json:"span_id,omitempty"`
	OrgID     string    `json:"org_id"`
	Type      string    `json:"type"`
	Name      string    `json:"name"`
	Data      string    `json:"data"`
	CreatedAt time.Time `json:"created_at"`
}

// --- Filter / Pagination ---

// SessionFilter contains filter criteria for listing sessions.
type SessionFilter struct {
	AgentName string
	Status    string
	Search    string
	StartDate *time.Time
	EndDate   *time.Time
	Limit     int
	Offset    int
	SortBy    string
	SortDir   string
	Page      int
	PerPage   int
}

// allowedSortColumns is a whitelist of columns that can be used for ORDER BY.
var allowedSortColumns = map[string]bool{
	"started_at":       true,
	"ended_at":         true,
	"duration_ms":      true,
	"total_tokens":     true,
	"total_cost_cents": true,
	"agent_name":       true,
	"status":           true,
	"created_at":       true,
}

// allowedSortDirs is a whitelist of allowed sort directions.
var allowedSortDirs = map[string]bool{
	"asc":  true,
	"desc": true,
}

// Normalize applies defaults and clamps pagination parameters.
func (f *SessionFilter) Normalize() {
	// Page/PerPage based pagination takes precedence over raw Limit/Offset
	if f.Page > 0 || f.PerPage > 0 {
		if f.Page <= 0 {
			f.Page = 1
		}
		if f.PerPage <= 0 {
			f.PerPage = 50
		}
		if f.PerPage > 100 {
			f.PerPage = 100
		}
		f.Limit = f.PerPage
		f.Offset = (f.Page - 1) * f.PerPage
	} else {
		// Legacy limit/offset mode
		if f.Limit <= 0 {
			f.Limit = 50
		}
		if f.Limit > 200 {
			f.Limit = 200
		}
		// Derive page/perPage for response meta
		f.PerPage = f.Limit
		if f.Offset > 0 {
			f.Page = (f.Offset / f.Limit) + 1
		} else {
			f.Page = 1
		}
	}

	// Sort defaults
	if f.SortBy == "" || !allowedSortColumns[f.SortBy] {
		f.SortBy = "started_at"
	}
	if f.SortDir == "" || !allowedSortDirs[f.SortDir] {
		f.SortDir = "desc"
	}
}

// --- Query Methods ---

// hasOnlyTimeFilters returns true if the filter has no filters beyond org_id and time range.
func hasOnlyTimeFilters(f SessionFilter) bool {
	return f.Search == "" && f.AgentName == "" && f.Status == ""
}

// getApproximateCount returns an approximate session count for the given org and time range.
// It first tries the materialized view (pre-aggregated, fast), then falls back to an exact
// count with a 2-second execution time limit for timeout protection.
func (s *ClickHouseStore) getApproximateCount(ctx context.Context, orgID string, start, end time.Time) (int, error) {
	// Try MV first (pre-aggregated, fast)
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(countMerge(session_count), 0)
		 FROM traceform.mv_sessions_hourly_data
		 WHERE org_id = ? AND hour >= ? AND hour <= ?`,
		orgID, start, end).Scan(&count)
	if err == nil && count > 0 {
		return count, nil
	}

	// Fallback: exact count with timeout protection
	err = s.db.QueryRowContext(ctx,
		`SELECT count() FROM traceform.sessions
		 WHERE org_id = ? AND started_at >= ? AND started_at <= ?
		 SETTINGS max_execution_time=2`,
		orgID, start, end).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("approximate count: %w", err)
	}
	return count, nil
}

// ListSessions returns sessions matching the given filter.
func (s *ClickHouseStore) ListSessions(ctx context.Context, orgID string, f SessionFilter) ([]Session, int, error) {
	f.Normalize()

	where := []string{"org_id = ?"}
	args := []interface{}{orgID}

	if f.Search != "" {
		where = append(where, "(positionCaseInsensitive(agent_name, ?) > 0 OR positionCaseInsensitive(id, ?) > 0)")
		args = append(args, f.Search, f.Search)
	}
	if f.AgentName != "" {
		where = append(where, "agent_name = ?")
		args = append(args, f.AgentName)
	}
	if f.Status != "" {
		where = append(where, "status = ?")
		args = append(args, f.Status)
	}
	if f.StartDate != nil {
		where = append(where, "started_at >= ?")
		args = append(args, *f.StartDate)
	}
	if f.EndDate != nil {
		where = append(where, "started_at <= ?")
		args = append(args, *f.EndDate)
	}

	whereClause := strings.Join(where, " AND ")

	// Count query: use approximate count for unfiltered queries with time range
	var total int
	if hasOnlyTimeFilters(f) && f.StartDate != nil && f.EndDate != nil {
		approx, err := s.getApproximateCount(ctx, orgID, *f.StartDate, *f.EndDate)
		if err == nil && approx > 0 {
			total = approx
		} else {
			// Fall back to exact count
			countQuery := fmt.Sprintf("SELECT count() FROM traceform.sessions WHERE %s", whereClause)
			if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
				return nil, 0, fmt.Errorf("count sessions: %w", err)
			}
		}
	} else {
		// Filtered queries always use exact count
		countQuery := fmt.Sprintf("SELECT count() FROM traceform.sessions WHERE %s", whereClause)
		if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
			return nil, 0, fmt.Errorf("count sessions: %w", err)
		}
	}

	// Data query — sort column and direction are whitelisted in Normalize()
	orderClause := fmt.Sprintf("%s %s", f.SortBy, strings.ToUpper(f.SortDir))
	query := fmt.Sprintf(
		`SELECT id, org_id, agent_name, agent_id, status, input, output, error,
		        error_fingerprint, metadata, total_tokens, total_cost_cents, total_spans, duration_ms,
		        has_healing, tags, started_at, ended_at, created_at
		 FROM traceform.sessions
		 WHERE %s
		 ORDER BY %s
		 LIMIT ? OFFSET ?`, whereClause, orderClause)

	args = append(args, f.Limit, f.Offset)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var sess Session
		var hasHealing uint8
		var tags []string
		if err := rows.Scan(
			&sess.ID, &sess.OrgID, &sess.AgentName, &sess.AgentID,
			&sess.Status, &sess.Input, &sess.Output, &sess.Error,
			&sess.ErrorFingerprint, &sess.Metadata, &sess.TotalTokens, &sess.TotalCostCents,
			&sess.TotalSpans, &sess.DurationMs, &hasHealing,
			&tags, &sess.StartedAt, &sess.EndedAt, &sess.CreatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan session: %w", err)
		}
		sess.HasHealing = hasHealing == 1
		sess.Tags = tags
		if sess.Tags == nil {
			sess.Tags = []string{}
		}
		sessions = append(sessions, sess)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate sessions: %w", err)
	}

	if sessions == nil {
		sessions = []Session{}
	}
	return sessions, total, nil
}

// GetSession returns a single session by ID.
func (s *ClickHouseStore) GetSession(ctx context.Context, orgID, sessionID string) (*Session, error) {
	query := `SELECT id, org_id, agent_name, agent_id, status, input, output, error,
	                 error_fingerprint, metadata, total_tokens, total_cost_cents, total_spans, duration_ms,
	                 has_healing, tags, started_at, ended_at, created_at
	          FROM traceform.sessions
	          WHERE org_id = ? AND id = ?
	          LIMIT 1`

	var sess Session
	var hasHealing uint8
	var tags []string
	err := s.db.QueryRowContext(ctx, query, orgID, sessionID).Scan(
		&sess.ID, &sess.OrgID, &sess.AgentName, &sess.AgentID,
		&sess.Status, &sess.Input, &sess.Output, &sess.Error,
		&sess.ErrorFingerprint, &sess.Metadata, &sess.TotalTokens, &sess.TotalCostCents,
		&sess.TotalSpans, &sess.DurationMs, &hasHealing,
		&tags, &sess.StartedAt, &sess.EndedAt, &sess.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	sess.HasHealing = hasHealing == 1
	sess.Tags = tags
	if sess.Tags == nil {
		sess.Tags = []string{}
	}
	return &sess, nil
}

// GetSessionSpans returns all spans for a session, ordered for tree construction.
func (s *ClickHouseStore) GetSessionSpans(ctx context.Context, orgID, sessionID string) ([]Span, error) {
	query := `SELECT id, session_id, org_id, parent_id, name, span_type, status,
	                 input, output, error, model, provider,
	                 input_tokens, output_tokens, total_tokens, cost_cents,
	                 duration_ms, metadata, started_at, ended_at, created_at
	          FROM traceform.spans
	          WHERE org_id = ? AND session_id = ?
	          ORDER BY started_at ASC
	          LIMIT 1000`

	rows, err := s.db.QueryContext(ctx, query, orgID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get session spans: %w", err)
	}
	defer rows.Close()

	var spans []Span
	for rows.Next() {
		var sp Span
		if err := rows.Scan(
			&sp.ID, &sp.SessionID, &sp.OrgID, &sp.ParentID,
			&sp.Name, &sp.SpanType, &sp.Status,
			&sp.Input, &sp.Output, &sp.Error,
			&sp.Model, &sp.Provider,
			&sp.InputTokens, &sp.OutputTokens, &sp.TotalTokens, &sp.CostCents,
			&sp.DurationMs, &sp.Metadata, &sp.StartedAt, &sp.EndedAt, &sp.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan span: %w", err)
		}
		spans = append(spans, sp)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate spans: %w", err)
	}

	if spans == nil {
		spans = []Span{}
	}
	return spans, nil
}

// GetSessionEvents returns all events for a session.
func (s *ClickHouseStore) GetSessionEvents(ctx context.Context, orgID, sessionID string) ([]Event, error) {
	query := `SELECT id, session_id, span_id, org_id, type, name, data, created_at
	          FROM traceform.events
	          WHERE org_id = ? AND session_id = ?
	          ORDER BY created_at ASC`

	rows, err := s.db.QueryContext(ctx, query, orgID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get session events: %w", err)
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var ev Event
		if err := rows.Scan(
			&ev.ID, &ev.SessionID, &ev.SpanID, &ev.OrgID,
			&ev.Type, &ev.Name, &ev.Data, &ev.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		events = append(events, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate events: %w", err)
	}

	if events == nil {
		events = []Event{}
	}
	return events, nil
}

// --- Analytics Queries ---

// OverviewStats holds aggregate statistics for the overview endpoint.
type OverviewStats struct {
	TotalSessions   int     `json:"total_sessions"`
	FailedSessions  int     `json:"failed_sessions"`
	FailureRate     float64 `json:"failure_rate"`
	AvgCostCents    float64 `json:"avg_cost_cents"`
	AvgDurationMs   float64 `json:"avg_duration_ms"`
	TotalTokens     uint64  `json:"total_tokens"`
	TotalCostCents  uint64  `json:"total_cost_cents"`
	HealedSessions  int     `json:"healed_sessions"`
}

// GetOverviewStats computes aggregate stats for a time range.
func (s *ClickHouseStore) GetOverviewStats(ctx context.Context, orgID string, start, end time.Time) (*OverviewStats, error) {
	query := `SELECT
	            count() AS total,
	            countIf(status = 'failed') AS failed,
	            if(count() > 0, countIf(status = 'failed') / count(), 0) AS failure_rate,
	            if(count() > 0, avg(total_cost_cents), 0) AS avg_cost,
	            if(count() > 0, avg(duration_ms), 0) AS avg_duration,
	            sum(total_tokens) AS tokens,
	            sum(total_cost_cents) AS cost,
	            countIf(has_healing = 1) AS healed
	          FROM traceform.sessions
	          WHERE org_id = ? AND started_at >= ? AND started_at <= ?`

	var stats OverviewStats
	err := s.db.QueryRowContext(ctx, query, orgID, start, end).Scan(
		&stats.TotalSessions, &stats.FailedSessions, &stats.FailureRate,
		&stats.AvgCostCents, &stats.AvgDurationMs,
		&stats.TotalTokens, &stats.TotalCostCents, &stats.HealedSessions,
	)
	if err != nil {
		return nil, fmt.Errorf("get overview stats: %w", err)
	}
	return &stats, nil
}

// TimeSeriesPoint represents a single data point in a time series.
type TimeSeriesPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Count     int       `json:"count"`
}

// GetSessionsOverTime returns session counts bucketed by the given interval.
func (s *ClickHouseStore) GetSessionsOverTime(ctx context.Context, orgID string, start, end time.Time, intervalSec int) ([]TimeSeriesPoint, error) {
	query := `SELECT
	            toStartOfInterval(started_at, INTERVAL ? SECOND) AS bucket,
	            count() AS cnt
	          FROM traceform.sessions
	          WHERE org_id = ? AND started_at >= ? AND started_at <= ?
	          GROUP BY bucket
	          ORDER BY bucket ASC`

	rows, err := s.db.QueryContext(ctx, query, intervalSec, orgID, start, end)
	if err != nil {
		return nil, fmt.Errorf("sessions over time: %w", err)
	}
	defer rows.Close()

	var points []TimeSeriesPoint
	for rows.Next() {
		var p TimeSeriesPoint
		if err := rows.Scan(&p.Timestamp, &p.Count); err != nil {
			return nil, fmt.Errorf("scan time series point: %w", err)
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate time series: %w", err)
	}

	if points == nil {
		points = []TimeSeriesPoint{}
	}
	return points, nil
}

// FailureRatePoint represents failure rate at a point in time.
type FailureRatePoint struct {
	Timestamp   time.Time `json:"timestamp"`
	Total       int       `json:"total"`
	Failed      int       `json:"failed"`
	FailureRate float64   `json:"failure_rate"`
}

// GetFailureRateOverTime returns failure rate bucketed by the given interval.
func (s *ClickHouseStore) GetFailureRateOverTime(ctx context.Context, orgID string, start, end time.Time, intervalSec int) ([]FailureRatePoint, error) {
	query := `SELECT
	            toStartOfInterval(started_at, INTERVAL ? SECOND) AS bucket,
	            count() AS total,
	            countIf(status = 'failed') AS failed,
	            if(count() > 0, countIf(status = 'failed') / count(), 0) AS rate
	          FROM traceform.sessions
	          WHERE org_id = ? AND started_at >= ? AND started_at <= ?
	          GROUP BY bucket
	          ORDER BY bucket ASC`

	rows, err := s.db.QueryContext(ctx, query, intervalSec, orgID, start, end)
	if err != nil {
		return nil, fmt.Errorf("failure rate over time: %w", err)
	}
	defer rows.Close()

	var points []FailureRatePoint
	for rows.Next() {
		var p FailureRatePoint
		if err := rows.Scan(&p.Timestamp, &p.Total, &p.Failed, &p.FailureRate); err != nil {
			return nil, fmt.Errorf("scan failure rate point: %w", err)
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate failure rate: %w", err)
	}

	if points == nil {
		points = []FailureRatePoint{}
	}
	return points, nil
}

// --- Materialized View Query Methods ---

// GetOverviewFromMV computes aggregate stats from the mv_sessions_hourly_data materialized view.
func (s *ClickHouseStore) GetOverviewFromMV(ctx context.Context, orgID string, start, end time.Time) (*OverviewStats, error) {
	query := `SELECT
	            countMerge(session_count) AS total_sessions,
	            countMerge(failed_count) AS total_failed,
	            countMerge(healed_count) AS total_healed,
	            sumMerge(sum_tokens) AS total_tokens,
	            sumMerge(sum_cost_cents) AS total_cost_cents,
	            sumMerge(sum_duration_ms) / GREATEST(countMerge(session_count), 1) AS avg_duration_ms,
	            maxMerge(max_duration_ms) AS max_duration_ms
	          FROM traceform.mv_sessions_hourly_data
	          WHERE org_id = ? AND hour >= ? AND hour <= ?`

	var totalSessions, totalFailed, totalHealed int
	var totalTokens, totalCostCents uint64
	var avgDurationMs float64
	var maxDurationMs uint64

	err := s.db.QueryRowContext(ctx, query, orgID, start, end).Scan(
		&totalSessions, &totalFailed, &totalHealed,
		&totalTokens, &totalCostCents,
		&avgDurationMs, &maxDurationMs,
	)
	if err != nil {
		return nil, fmt.Errorf("get overview from MV: %w", err)
	}

	var failureRate float64
	if totalSessions > 0 {
		failureRate = float64(totalFailed) / float64(totalSessions)
	}

	var avgCost float64
	if totalSessions > 0 {
		avgCost = float64(totalCostCents) / float64(totalSessions)
	}

	return &OverviewStats{
		TotalSessions:  totalSessions,
		FailedSessions: totalFailed,
		FailureRate:    failureRate,
		AvgCostCents:   avgCost,
		AvgDurationMs:  avgDurationMs,
		TotalTokens:    totalTokens,
		TotalCostCents: totalCostCents,
		HealedSessions: totalHealed,
	}, nil
}

// GetSessionsOverTimeFromMV returns session counts bucketed by hour from the materialized view.
func (s *ClickHouseStore) GetSessionsOverTimeFromMV(ctx context.Context, orgID string, start, end time.Time) ([]TimeSeriesPoint, error) {
	query := `SELECT
	            hour AS bucket,
	            countMerge(session_count) AS cnt
	          FROM traceform.mv_sessions_hourly_data
	          WHERE org_id = ? AND hour >= ? AND hour <= ?
	          GROUP BY hour
	          ORDER BY hour ASC`

	rows, err := s.db.QueryContext(ctx, query, orgID, start, end)
	if err != nil {
		return nil, fmt.Errorf("sessions over time from MV: %w", err)
	}
	defer rows.Close()

	var points []TimeSeriesPoint
	for rows.Next() {
		var p TimeSeriesPoint
		if err := rows.Scan(&p.Timestamp, &p.Count); err != nil {
			return nil, fmt.Errorf("scan MV time series point: %w", err)
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate MV time series: %w", err)
	}

	if points == nil {
		points = []TimeSeriesPoint{}
	}
	return points, nil
}

// GetFailureRateFromMV returns failure rate bucketed by hour from the materialized view.
func (s *ClickHouseStore) GetFailureRateFromMV(ctx context.Context, orgID string, start, end time.Time) ([]FailureRatePoint, error) {
	query := `SELECT
	            hour AS bucket,
	            countMerge(session_count) AS total,
	            countMerge(failed_count) AS failed,
	            IF(countMerge(session_count) > 0,
	               countMerge(failed_count) / countMerge(session_count), 0) AS rate
	          FROM traceform.mv_sessions_hourly_data
	          WHERE org_id = ? AND hour >= ? AND hour <= ?
	          GROUP BY hour
	          ORDER BY hour ASC`

	rows, err := s.db.QueryContext(ctx, query, orgID, start, end)
	if err != nil {
		return nil, fmt.Errorf("failure rate from MV: %w", err)
	}
	defer rows.Close()

	var points []FailureRatePoint
	for rows.Next() {
		var p FailureRatePoint
		if err := rows.Scan(&p.Timestamp, &p.Total, &p.Failed, &p.FailureRate); err != nil {
			return nil, fmt.Errorf("scan MV failure rate point: %w", err)
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate MV failure rate: %w", err)
	}

	if points == nil {
		points = []FailureRatePoint{}
	}
	return points, nil
}

// GetOverviewWithCounters computes aggregate stats by joining the MV with session_counters.
func (s *ClickHouseStore) GetOverviewWithCounters(ctx context.Context, orgID string, start, end time.Time) (*OverviewStats, error) {
	query := `SELECT
	            COALESCE(countMerge(mv.session_count), 0) + COALESCE(countMerge(c.session_count), 0) AS total_sessions,
	            COALESCE(countMerge(mv.failed_count), 0) AS total_failed,
	            COALESCE(countMerge(mv.healed_count), 0) AS total_healed,
	            COALESCE(sumMerge(mv.sum_tokens), 0) + COALESCE(sumMerge(c.sum_tokens), 0) AS total_tokens,
	            COALESCE(sumMerge(mv.sum_cost_cents), 0) + COALESCE(sumMerge(c.sum_cost_cents), 0) AS total_cost_cents,
	            (COALESCE(sumMerge(mv.sum_duration_ms), 0) + COALESCE(sumMerge(c.sum_duration_ms), 0)) /
	                GREATEST(COALESCE(countMerge(mv.session_count), 0) + COALESCE(countMerge(c.session_count), 0), 1) AS avg_duration_ms
	          FROM traceform.mv_sessions_hourly_data mv
	          FULL OUTER JOIN traceform.session_counters c
	              ON mv.org_id = c.org_id AND mv.agent_name = c.agent_name AND mv.hour = c.hour
	          WHERE (mv.org_id = ? AND mv.hour >= ? AND mv.hour <= ?)
	             OR (c.org_id = ? AND c.hour >= ? AND c.hour <= ?)`

	var totalSessions, totalFailed, totalHealed int
	var totalTokens, totalCostCents uint64
	var avgDurationMs float64

	err := s.db.QueryRowContext(ctx, query, orgID, start, end, orgID, start, end).Scan(
		&totalSessions, &totalFailed, &totalHealed,
		&totalTokens, &totalCostCents,
		&avgDurationMs,
	)
	if err != nil {
		return nil, fmt.Errorf("get overview with counters: %w", err)
	}

	var failureRate float64
	if totalSessions > 0 {
		failureRate = float64(totalFailed) / float64(totalSessions)
	}

	var avgCost float64
	if totalSessions > 0 {
		avgCost = float64(totalCostCents) / float64(totalSessions)
	}

	return &OverviewStats{
		TotalSessions:  totalSessions,
		FailedSessions: totalFailed,
		FailureRate:    failureRate,
		AvgCostCents:   avgCost,
		AvgDurationMs:  avgDurationMs,
		TotalTokens:    totalTokens,
		TotalCostCents: totalCostCents,
		HealedSessions: totalHealed,
	}, nil
}

// --- Error Group Queries ---

// ErrorGroup represents an aggregated group of sessions sharing the same error fingerprint.
type ErrorGroup struct {
	Fingerprint    string    `json:"fingerprint"`
	SampleError    string    `json:"message"`
	Count          int       `json:"count"`
	FirstSeen      time.Time `json:"first_seen"`
	LastSeen       time.Time `json:"last_seen"`
	AffectedAgents []string  `json:"agents"`
}

// ListErrorGroups returns error groups aggregated by fingerprint for the given time range.
func (s *ClickHouseStore) ListErrorGroups(ctx context.Context, orgID string, start, end time.Time) ([]ErrorGroup, error) {
	query := `SELECT
	            error_fingerprint,
	            any(error) as sample_error,
	            count() as occurrence_count,
	            min(started_at) as first_seen,
	            max(started_at) as last_seen,
	            groupUniqArray(agent_name) as affected_agents
	          FROM traceform.sessions
	          WHERE org_id = ? AND error != '' AND error_fingerprint != ''
	            AND started_at >= ? AND started_at <= ?
	          GROUP BY error_fingerprint
	          ORDER BY occurrence_count DESC
	          LIMIT 50`

	rows, err := s.db.QueryContext(ctx, query, orgID, start, end)
	if err != nil {
		return nil, fmt.Errorf("list error groups: %w", err)
	}
	defer rows.Close()

	var groups []ErrorGroup
	for rows.Next() {
		var g ErrorGroup
		var agents []string
		if err := rows.Scan(
			&g.Fingerprint, &g.SampleError, &g.Count,
			&g.FirstSeen, &g.LastSeen, &agents,
		); err != nil {
			return nil, fmt.Errorf("scan error group: %w", err)
		}
		g.AffectedAgents = agents
		if g.AffectedAgents == nil {
			g.AffectedAgents = []string{}
		}
		groups = append(groups, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate error groups: %w", err)
	}

	if groups == nil {
		groups = []ErrorGroup{}
	}
	return groups, nil
}

// GetErrorGroupSessions returns sessions matching a specific error fingerprint.
func (s *ClickHouseStore) GetErrorGroupSessions(ctx context.Context, orgID, fingerprint string, start, end time.Time, limit, offset int) ([]Session, int, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	// Count
	countQuery := `SELECT count() FROM traceform.sessions
	               WHERE org_id = ? AND error_fingerprint = ?
	                 AND started_at >= ? AND started_at <= ?`
	var total int
	if err := s.db.QueryRowContext(ctx, countQuery, orgID, fingerprint, start, end).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count error group sessions: %w", err)
	}

	// Data
	query := `SELECT id, org_id, agent_name, agent_id, status, input, output, error,
	                 error_fingerprint, metadata, total_tokens, total_cost_cents, total_spans, duration_ms,
	                 has_healing, tags, started_at, ended_at, created_at
	          FROM traceform.sessions
	          WHERE org_id = ? AND error_fingerprint = ?
	            AND started_at >= ? AND started_at <= ?
	          ORDER BY started_at DESC
	          LIMIT ? OFFSET ?`

	rows, err := s.db.QueryContext(ctx, query, orgID, fingerprint, start, end, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("get error group sessions: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var sess Session
		var hasHealing uint8
		var tags []string
		if err := rows.Scan(
			&sess.ID, &sess.OrgID, &sess.AgentName, &sess.AgentID,
			&sess.Status, &sess.Input, &sess.Output, &sess.Error,
			&sess.ErrorFingerprint, &sess.Metadata, &sess.TotalTokens, &sess.TotalCostCents,
			&sess.TotalSpans, &sess.DurationMs, &hasHealing,
			&tags, &sess.StartedAt, &sess.EndedAt, &sess.CreatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan error group session: %w", err)
		}
		sess.HasHealing = hasHealing == 1
		sess.Tags = tags
		if sess.Tags == nil {
			sess.Tags = []string{}
		}
		sessions = append(sessions, sess)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate error group sessions: %w", err)
	}

	if sessions == nil {
		sessions = []Session{}
	}
	return sessions, total, nil
}

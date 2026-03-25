package worker

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	shieldservice "github.com/agentstack/agentstack/internal/shield/service"
	shieldstore "github.com/agentstack/agentstack/internal/shield/store"
	"github.com/agentstack/agentstack/internal/storage"
	"github.com/agentstack/agentstack/internal/trace/service"
	"github.com/nats-io/nats.go"
)

const (
	batchSize     = 100
	flushInterval = 2 * time.Second
	maxPayloadSize = 4096

	SubjectCounterIngest = "trace.ingest.counter"
)

// SessionCounter represents an aggregated session counter event.
type SessionCounter struct {
	OrgID          string `json:"org_id"`
	AgentName      string `json:"agent_name"`
	Status         string `json:"status"`
	TotalTokens    uint64 `json:"total_tokens"`
	TotalCostCents uint64 `json:"total_cost_cents"`
	DurationMs     uint64 `json:"duration_ms"`
	SpanCount      uint32 `json:"span_count"`
	CreatedAt      string `json:"created_at"`
}

// IngestWriter subscribes to NATS subjects and batch-writes trace data to ClickHouse.
type IngestWriter struct {
	nc        *nats.Conn
	chDB      *sql.DB
	logger    *slog.Logger
	blobStore storage.BlobStore

	sessionBuf []service.SessionIngestRequest
	spanBuf    []service.SpanIngestRequest
	eventBuf   []service.EventIngestRequest
	healingBuf []shieldservice.HealingIngestRequest
	counterBuf []SessionCounter

	mu         sync.Mutex
	done       chan struct{}
	subs       []*nats.Subscription
	counterSub *nats.Subscription
}

// NewIngestWriter creates a new NATS-to-ClickHouse batch writer.
func NewIngestWriter(nc *nats.Conn, chDB *sql.DB, blobStore storage.BlobStore, logger *slog.Logger) *IngestWriter {
	return &IngestWriter{
		nc:        nc,
		chDB:      chDB,
		blobStore: blobStore,
		logger:    logger,
		done:      make(chan struct{}),
	}
}

// truncatePayload truncates large payloads, storing the full content in blob storage.
func (w *IngestWriter) truncatePayload(ctx context.Context, payload string) (truncated string, wasTruncated bool, hash string) {
	if len(payload) <= maxPayloadSize {
		return payload, false, ""
	}
	h := sha256.Sum256([]byte(payload))
	hash = hex.EncodeToString(h[:])
	// Store full payload in blob store
	if w.blobStore != nil {
		if err := w.blobStore.Put(ctx, hash, []byte(payload)); err != nil {
			w.logger.Warn("blob put failed", "error", err, "hash", hash[:16])
		}
	}
	return payload[:maxPayloadSize-3] + "...", true, hash
}

// Start begins subscribing to NATS subjects and periodically flushing buffers.
func (w *IngestWriter) Start() error {
	subSession, err := w.nc.Subscribe(service.SubjectSessionIngest, w.handleSession)
	if err != nil {
		return fmt.Errorf("subscribe session: %w", err)
	}

	subSpan, err := w.nc.Subscribe(service.SubjectSpanIngest, w.handleSpan)
	if err != nil {
		return fmt.Errorf("subscribe span: %w", err)
	}

	subEvent, err := w.nc.Subscribe(service.SubjectEventIngest, w.handleEvent)
	if err != nil {
		return fmt.Errorf("subscribe event: %w", err)
	}

	subHealing, err := w.nc.Subscribe(shieldservice.SubjectHealingIngest, w.handleHealing)
	if err != nil {
		return fmt.Errorf("subscribe healing: %w", err)
	}

	subCounter, err := w.nc.Subscribe(SubjectCounterIngest, w.handleCounter)
	if err != nil {
		return fmt.Errorf("subscribe counter: %w", err)
	}
	w.counterSub = subCounter

	w.subs = []*nats.Subscription{subSession, subSpan, subEvent, subHealing}

	w.logger.Info("ingest writer started",
		"subjects", []string{service.SubjectSessionIngest, service.SubjectSpanIngest, service.SubjectEventIngest, shieldservice.SubjectHealingIngest, SubjectCounterIngest},
		"batch_size", batchSize,
		"flush_interval", flushInterval,
	)

	go w.flushLoop()
	return nil
}

// Stop gracefully shuts down the ingest writer, flushing remaining buffers.
func (w *IngestWriter) Stop() {
	close(w.done)
	for _, sub := range w.subs {
		if err := sub.Unsubscribe(); err != nil {
			w.logger.Warn("failed to unsubscribe", "error", err)
		}
	}
	if w.counterSub != nil {
		if err := w.counterSub.Unsubscribe(); err != nil {
			w.logger.Warn("failed to unsubscribe counter", "error", err)
		}
	}
	// Final flush
	w.flush()
	w.logger.Info("ingest writer stopped")
}

func (w *IngestWriter) handleSession(msg *nats.Msg) {
	var req service.SessionIngestRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		w.logger.Error("failed to unmarshal session", "error", err)
		return
	}

	w.mu.Lock()
	w.sessionBuf = append(w.sessionBuf, req)
	shouldFlush := len(w.sessionBuf) >= batchSize
	w.mu.Unlock()

	if shouldFlush {
		w.flushSessions()
	}
}

func (w *IngestWriter) handleSpan(msg *nats.Msg) {
	var req service.SpanIngestRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		w.logger.Error("failed to unmarshal span", "error", err)
		return
	}

	w.mu.Lock()
	w.spanBuf = append(w.spanBuf, req)
	shouldFlush := len(w.spanBuf) >= batchSize
	w.mu.Unlock()

	if shouldFlush {
		w.flushSpans()
	}
}

func (w *IngestWriter) handleEvent(msg *nats.Msg) {
	var req service.EventIngestRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		w.logger.Error("failed to unmarshal event", "error", err)
		return
	}

	w.mu.Lock()
	w.eventBuf = append(w.eventBuf, req)
	shouldFlush := len(w.eventBuf) >= batchSize
	w.mu.Unlock()

	if shouldFlush {
		w.flushEvents()
	}
}

func (w *IngestWriter) handleHealing(msg *nats.Msg) {
	var req shieldservice.HealingIngestRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		w.logger.Error("failed to unmarshal healing event", "error", err)
		return
	}

	w.mu.Lock()
	w.healingBuf = append(w.healingBuf, req)
	shouldFlush := len(w.healingBuf) >= batchSize
	w.mu.Unlock()

	if shouldFlush {
		w.flushHealing()
	}
}

func (w *IngestWriter) flushLoop() {
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			w.flush()
		case <-w.done:
			return
		}
	}
}

func (w *IngestWriter) flush() {
	w.flushSessions()
	w.flushSpans()
	w.flushEvents()
	w.flushHealing()
	w.flushCounters()
}

func (w *IngestWriter) flushSessions() {
	w.mu.Lock()
	if len(w.sessionBuf) == 0 {
		w.mu.Unlock()
		return
	}
	batch := w.sessionBuf
	w.sessionBuf = nil
	w.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := w.writeSessions(ctx, batch); err != nil {
		w.logger.Error("failed to write sessions batch", "count", len(batch), "error", err)
		// Re-queue on failure
		w.mu.Lock()
		w.sessionBuf = append(batch, w.sessionBuf...)
		w.mu.Unlock()
		return
	}

	w.logger.Debug("flushed sessions", "count", len(batch))
}

func (w *IngestWriter) flushSpans() {
	w.mu.Lock()
	if len(w.spanBuf) == 0 {
		w.mu.Unlock()
		return
	}
	batch := w.spanBuf
	w.spanBuf = nil
	w.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := w.writeSpans(ctx, batch); err != nil {
		w.logger.Error("failed to write spans batch", "count", len(batch), "error", err)
		w.mu.Lock()
		w.spanBuf = append(batch, w.spanBuf...)
		w.mu.Unlock()
		return
	}

	w.logger.Debug("flushed spans", "count", len(batch))
}

func (w *IngestWriter) flushEvents() {
	w.mu.Lock()
	if len(w.eventBuf) == 0 {
		w.mu.Unlock()
		return
	}
	batch := w.eventBuf
	w.eventBuf = nil
	w.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := w.writeEvents(ctx, batch); err != nil {
		w.logger.Error("failed to write events batch", "count", len(batch), "error", err)
		w.mu.Lock()
		w.eventBuf = append(batch, w.eventBuf...)
		w.mu.Unlock()
		return
	}

	w.logger.Debug("flushed events", "count", len(batch))
}

func (w *IngestWriter) writeSessions(ctx context.Context, sessions []service.SessionIngestRequest) error {
	tx, err := w.chDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}

	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO agentstack.sessions
		 (id, org_id, agent_name, agent_id, status, input, output, error,
		  metadata, total_tokens, total_cost_cents, total_spans, duration_ms,
		  has_healing, tags, started_at, ended_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("prepare: %w", err)
	}
	defer stmt.Close()

	for _, s := range sessions {
		startedAt := parseTime(s.StartedAt)
		endedAt := parseTime(s.EndedAt)

		_, err := stmt.ExecContext(ctx,
			s.ID, s.OrgID, s.AgentName, s.AgentID, s.Status,
			s.Input, s.Output, s.Error, s.Metadata,
			s.TotalTokens, s.TotalCostCents, s.TotalSpans, s.DurationMs,
			s.HasHealing, s.Tags, startedAt, endedAt,
		)
		if err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("exec session %s: %w", s.ID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

func (w *IngestWriter) writeSpans(ctx context.Context, spans []service.SpanIngestRequest) error {
	tx, err := w.chDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}

	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO agentstack.spans
		 (id, session_id, org_id, parent_id, name, span_type, status,
		  input, output, error, model, provider,
		  input_tokens, output_tokens, total_tokens, cost_cents,
		  duration_ms, metadata, started_at, ended_at,
		  input_truncated, output_truncated, input_hash, output_hash)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("prepare: %w", err)
	}
	defer stmt.Close()

	for _, s := range spans {
		startedAt := parseTime(s.StartedAt)
		endedAt := parseTime(s.EndedAt)

		input, inputTruncated, inputHash := w.truncatePayload(ctx, s.Input)
		output, outputTruncated, outputHash := w.truncatePayload(ctx, s.Output)

		_, err := stmt.ExecContext(ctx,
			s.ID, s.SessionID, s.OrgID, s.ParentID, s.Name, s.SpanType, s.Status,
			input, output, s.Error, s.Model, s.Provider,
			s.InputTokens, s.OutputTokens, s.TotalTokens, s.CostCents,
			s.DurationMs, s.Metadata, startedAt, endedAt,
			inputTruncated, outputTruncated, inputHash, outputHash,
		)
		if err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("exec span %s: %w", s.ID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

func (w *IngestWriter) writeEvents(ctx context.Context, events []service.EventIngestRequest) error {
	tx, err := w.chDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}

	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO agentstack.events
		 (id, session_id, span_id, org_id, type, name, data, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("prepare: %w", err)
	}
	defer stmt.Close()

	for _, e := range events {
		createdAt := parseTime(e.CreatedAt)

		_, err := stmt.ExecContext(ctx,
			e.ID, e.SessionID, e.SpanID, e.OrgID,
			e.Type, e.Name, e.Data, createdAt,
		)
		if err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("exec event %s: %w", e.ID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

func (w *IngestWriter) flushHealing() {
	w.mu.Lock()
	if len(w.healingBuf) == 0 {
		w.mu.Unlock()
		return
	}
	batch := w.healingBuf
	w.healingBuf = nil
	w.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := w.writeHealing(ctx, batch); err != nil {
		w.logger.Error("failed to write healing events batch", "count", len(batch), "error", err)
		w.mu.Lock()
		w.healingBuf = append(batch, w.healingBuf...)
		w.mu.Unlock()
		return
	}

	w.logger.Debug("flushed healing events", "count", len(batch))
}

func (w *IngestWriter) writeHealing(ctx context.Context, events []shieldservice.HealingIngestRequest) error {
	// Convert ingest requests to store events and delegate to the shield store.
	storeEvents := make([]shieldstore.HealingEvent, len(events))
	for i, e := range events {
		createdAt := parseTime(e.CreatedAt)

		storeEvents[i] = shieldstore.HealingEvent{
			ID:            e.ID,
			SessionID:     e.SessionID,
			SpanID:        e.SpanID,
			OrgID:         e.OrgID,
			AgentName:     e.AgentName,
			HealingType:   e.HealingType,
			TriggerReason: e.TriggerReason,
			ActionTaken:   e.ActionTaken,
			OriginalState: e.OriginalState,
			HealedState:   e.HealedState,
			Success:       e.Success,
			LatencyMs:     e.LatencyMs,
			Metadata:      e.Metadata,
			CreatedAt:     createdAt,
		}
	}

	chStore := shieldstore.NewClickHouseStore(w.chDB)
	return chStore.InsertHealingEvents(ctx, storeEvents)
}

func (w *IngestWriter) handleCounter(msg *nats.Msg) {
	var counter SessionCounter
	if err := json.Unmarshal(msg.Data, &counter); err != nil {
		w.logger.Error("unmarshal counter", "error", err)
		return
	}
	w.mu.Lock()
	w.counterBuf = append(w.counterBuf, counter)
	if len(w.counterBuf) >= batchSize {
		w.mu.Unlock()
		w.flushCounters()
		return
	}
	w.mu.Unlock()
}

func (w *IngestWriter) flushCounters() {
	w.mu.Lock()
	if len(w.counterBuf) == 0 {
		w.mu.Unlock()
		return
	}
	batch := w.counterBuf
	w.counterBuf = nil
	w.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := w.writeCounters(ctx, batch); err != nil {
		w.logger.Error("write counters failed", "error", err, "count", len(batch))
		w.mu.Lock()
		w.counterBuf = append(batch, w.counterBuf...)
		w.mu.Unlock()
	}
}

func (w *IngestWriter) writeCounters(ctx context.Context, counters []SessionCounter) error {
	tx, err := w.chDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	for _, c := range counters {
		hour := parseTime(c.CreatedAt).Truncate(time.Hour)
		_, err := tx.ExecContext(ctx,
			`INSERT INTO agentstack.session_counters
			 SELECT ?, ?, ?, ?,
				 countState(),
				 sumState(toUInt64(?)),
				 sumState(toUInt64(?)),
				 sumState(toUInt64(?)),
				 sumState(toUInt32(?))`,
			c.OrgID, c.AgentName, c.Status, hour,
			c.TotalTokens, c.TotalCostCents, c.DurationMs, c.SpanCount,
		)
		if err != nil {
			return fmt.Errorf("insert counter: %w", err)
		}
	}
	return tx.Commit()
}

// parseTime parses an RFC3339 timestamp string, returning a zero time on failure.
func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		// Try RFC3339 without nanos
		t, err = time.Parse(time.RFC3339, s)
		if err != nil {
			return time.Time{}
		}
	}
	return t
}

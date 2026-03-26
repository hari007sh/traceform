package gateway

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/agentstack/agentstack/internal/route/store"
	"github.com/nats-io/nats.go"
)

// AsyncLogger logs gateway requests asynchronously via NATS.
// Requests are buffered in a channel and published to NATS in batches.
type AsyncLogger struct {
	natsConn      *nats.Conn
	dbStore       *store.Store
	buffer        chan *store.GatewayRequest
	batchSize     int
	flushInterval time.Duration
	logger        *slog.Logger
	wg            sync.WaitGroup
	done          chan struct{}
	stopped       atomic.Bool
}

// NewAsyncLogger creates and starts an AsyncLogger.
func NewAsyncLogger(nc *nats.Conn, s *store.Store, logger *slog.Logger) *AsyncLogger {
	al := &AsyncLogger{
		natsConn:      nc,
		dbStore:       s,
		buffer:        make(chan *store.GatewayRequest, 10000),
		batchSize:     100,
		flushInterval: time.Second,
		logger:        logger,
		done:          make(chan struct{}),
	}
	al.wg.Add(1)
	go al.flushLoop()
	return al
}

// Log enqueues a gateway request for asynchronous logging.
// It never blocks the caller; if the buffer is full or the logger is stopped, the request is dropped.
func (al *AsyncLogger) Log(req *store.GatewayRequest) {
	if al.stopped.Load() {
		return
	}
	select {
	case al.buffer <- req:
	default:
		al.logger.Warn("gateway log buffer full, dropping request")
	}
}

// Stop flushes remaining requests and stops the logger.
func (al *AsyncLogger) Stop() {
	al.stopped.Store(true)
	close(al.done)
	al.wg.Wait()
}

func (al *AsyncLogger) flushLoop() {
	defer al.wg.Done()

	ticker := time.NewTicker(al.flushInterval)
	defer ticker.Stop()

	var batch []*store.GatewayRequest

	for {
		select {
		case req := <-al.buffer:
			batch = append(batch, req)
			if len(batch) >= al.batchSize {
				al.flush(batch)
				batch = nil
			}
		case <-ticker.C:
			if len(batch) > 0 {
				al.flush(batch)
				batch = nil
			}
		case <-al.done:
			// Drain remaining without closing the channel (closing causes panic
			// if Log() is called concurrently during shutdown).
			for {
				select {
				case req := <-al.buffer:
					batch = append(batch, req)
				default:
					if len(batch) > 0 {
						al.flush(batch)
					}
					return
				}
			}
		}
	}
}

func (al *AsyncLogger) flush(batch []*store.GatewayRequest) {
	// Publish to NATS if available
	if al.natsConn != nil && al.natsConn.IsConnected() {
		for _, req := range batch {
			data, err := json.Marshal(req)
			if err != nil {
				al.logger.Error("marshal gateway request for NATS", "error", err)
				continue
			}
			if err := al.natsConn.Publish("agentstack.gateway.requests", data); err != nil {
				al.logger.Error("publish gateway request to NATS", "error", err)
			}
		}
	}

	// Also write directly to PostgreSQL as a fallback
	if al.dbStore != nil {
		for _, req := range batch {
			if err := al.dbStore.InsertGatewayRequest(context.Background(), req); err != nil {
				al.logger.Error("insert gateway request", "error", err)
			}
		}
	}
}

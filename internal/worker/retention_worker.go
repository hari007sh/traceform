package worker

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/traceform/traceform/internal/storage"
)

// RetentionWorker runs daily (configurable) and enforces per-org data retention
// tiers: downsampling warm-tier sessions in ClickHouse and cleaning up expired
// blobs from the blob store.
type RetentionWorker struct {
	chDB      *sql.DB
	pgDB      *sql.DB
	blobStore storage.BlobStore
	logger    *slog.Logger
	interval  time.Duration
	done      chan struct{}
	mu        sync.Mutex
}

// NewRetentionWorker creates a new retention worker.
func NewRetentionWorker(chDB, pgDB *sql.DB, blobStore storage.BlobStore, logger *slog.Logger, interval time.Duration) *RetentionWorker {
	return &RetentionWorker{
		chDB:      chDB,
		pgDB:      pgDB,
		blobStore: blobStore,
		logger:    logger,
		interval:  interval,
		done:      make(chan struct{}),
	}
}

// Start begins the periodic retention enforcement loop.
func (rw *RetentionWorker) Start() {
	rw.logger.Info("retention worker started", "interval", rw.interval)
	go rw.run()
}

// Stop terminates the retention enforcement loop.
func (rw *RetentionWorker) Stop() {
	close(rw.done)
	rw.logger.Info("retention worker stopped")
}

// run is the main ticker loop that calls enforce() on each tick.
func (rw *RetentionWorker) run() {
	ticker := time.NewTicker(rw.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			rw.enforce(context.Background())
		case <-rw.done:
			return
		}
	}
}

// orgRetentionConfig holds per-org retention settings from PostgreSQL.
type orgRetentionConfig struct {
	ID               string
	HotRetentionDays int
	WarmRetentionDays int
	BlobRetentionDays int
}

// enforce queries all orgs and applies retention policies for each.
func (rw *RetentionWorker) enforce(ctx context.Context) {
	rw.mu.Lock()
	defer rw.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()

	rows, err := rw.pgDB.QueryContext(ctx,
		`SELECT id, hot_retention_days, warm_retention_days, blob_retention_days FROM organizations`)
	if err != nil {
		rw.logger.Error("failed to query organizations for retention", "error", err)
		return
	}
	defer rows.Close()

	var orgs []orgRetentionConfig
	for rows.Next() {
		var org orgRetentionConfig
		if err := rows.Scan(&org.ID, &org.HotRetentionDays, &org.WarmRetentionDays, &org.BlobRetentionDays); err != nil {
			rw.logger.Error("failed to scan org retention config", "error", err)
			continue
		}
		orgs = append(orgs, org)
	}
	if err := rows.Err(); err != nil {
		rw.logger.Error("rows iteration error", "error", err)
		return
	}

	rw.logger.Info("retention enforcement starting", "org_count", len(orgs))

	for _, org := range orgs {
		rw.downsampleWarmSessions(ctx, org.ID, org.HotRetentionDays, org.WarmRetentionDays)
		rw.cleanupBlobs(ctx, org.ID, org.BlobRetentionDays)
	}

	rw.logger.Info("retention enforcement completed", "org_count", len(orgs))
}

// downsampleWarmSessions deletes 90% of successful sessions in the warm window
// (between hot and warm retention boundaries), keeping 10% via cityHash64 sampling.
// It also deletes corresponding spans for the removed sessions.
func (rw *RetentionWorker) downsampleWarmSessions(ctx context.Context, orgID string, hotDays, warmDays int) {
	// Delete spans for sessions that will be downsampled.
	// We delete spans first to avoid orphans.
	spanQuery := fmt.Sprintf(`ALTER TABLE traceform.spans DELETE WHERE
		org_id = '%s'
		AND session_id IN (
			SELECT id FROM traceform.sessions
			WHERE org_id = '%s'
			  AND status = 'completed'
			  AND started_at < now() - INTERVAL %d DAY
			  AND started_at >= now() - INTERVAL %d DAY
			  AND cityHash64(id) %% 10 != 0
		)`, orgID, orgID, hotDays, warmDays)

	_, err := rw.chDB.ExecContext(ctx, spanQuery)
	if err != nil {
		rw.logger.Error("failed to downsample warm spans",
			"org_id", orgID, "error", err)
		return
	}

	// Delete the downsampled sessions themselves.
	sessionQuery := fmt.Sprintf(`ALTER TABLE traceform.sessions DELETE WHERE
		org_id = '%s'
		AND status = 'completed'
		AND started_at < now() - INTERVAL %d DAY
		AND started_at >= now() - INTERVAL %d DAY
		AND cityHash64(id) %% 10 != 0`, orgID, hotDays, warmDays)

	_, err = rw.chDB.ExecContext(ctx, sessionQuery)
	if err != nil {
		rw.logger.Error("failed to downsample warm sessions",
			"org_id", orgID, "error", err)
		return
	}

	rw.logger.Info("downsampled warm-tier sessions",
		"org_id", orgID,
		"hot_days", hotDays,
		"warm_days", warmDays,
	)
}

// cleanupBlobs finds blob hashes referenced only by expired spans and deletes
// them from blob storage.
func (rw *RetentionWorker) cleanupBlobs(ctx context.Context, orgID string, blobDays int) {
	if rw.blobStore == nil {
		return
	}

	// Find all distinct hashes from expired spans.
	hashQuery := fmt.Sprintf(`SELECT DISTINCT input_hash FROM traceform.spans
		WHERE org_id = '%s' AND input_hash != '' AND started_at < now() - INTERVAL %d DAY
		UNION ALL
		SELECT DISTINCT output_hash FROM traceform.spans
		WHERE org_id = '%s' AND output_hash != '' AND started_at < now() - INTERVAL %d DAY`,
		orgID, blobDays, orgID, blobDays)

	rows, err := rw.chDB.QueryContext(ctx, hashQuery)
	if err != nil {
		rw.logger.Error("failed to query expired blob hashes",
			"org_id", orgID, "error", err)
		return
	}
	defer rows.Close()

	var candidates []string
	for rows.Next() {
		var hash string
		if err := rows.Scan(&hash); err != nil {
			rw.logger.Error("failed to scan blob hash", "error", err)
			continue
		}
		candidates = append(candidates, hash)
	}
	if err := rows.Err(); err != nil {
		rw.logger.Error("blob hash rows iteration error", "error", err)
		return
	}

	// Deduplicate candidates (UNION ALL may produce duplicates for hashes used in both input and output).
	seen := make(map[string]struct{}, len(candidates))
	uniqueCandidates := make([]string, 0, len(candidates))
	for _, h := range candidates {
		if _, ok := seen[h]; !ok {
			seen[h] = struct{}{}
			uniqueCandidates = append(uniqueCandidates, h)
		}
	}

	deleted := 0
	for _, hash := range uniqueCandidates {
		// Check if any non-expired span still references this hash.
		var refCount int
		countQuery := fmt.Sprintf(`SELECT count() FROM traceform.spans
			WHERE (input_hash = '%s' OR output_hash = '%s') AND started_at >= now() - INTERVAL %d DAY`,
			hash, hash, blobDays)

		err := rw.chDB.QueryRowContext(ctx, countQuery).Scan(&refCount)
		if err != nil {
			rw.logger.Error("failed to check blob references",
				"hash", hash, "error", err)
			continue
		}

		if refCount == 0 {
			if err := rw.blobStore.Delete(ctx, hash); err != nil {
				rw.logger.Error("failed to delete blob",
					"hash", hash, "error", err)
				continue
			}
			deleted++
		}
	}

	if deleted > 0 || len(uniqueCandidates) > 0 {
		rw.logger.Info("blob cleanup completed",
			"org_id", orgID,
			"candidates", len(uniqueCandidates),
			"deleted", deleted,
			"blob_days", blobDays,
		)
	}
}

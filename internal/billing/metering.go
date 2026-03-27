// Package billing provides usage metering and plan enforcement for AgentStack.
package billing

import (
	"context"
	"fmt"
	"time"

	"github.com/agentstack/agentstack/internal/server/middleware"
	"github.com/redis/go-redis/v9"
)

// Meter tracks per-org monthly event usage in Redis.
type Meter struct {
	rdb *redis.Client
}

// NewMeter creates a new Meter backed by the given Redis client.
func NewMeter(rdb *redis.Client) *Meter {
	return &Meter{rdb: rdb}
}

// IncrementEvents adds to the org's monthly event count.
// The Redis key auto-expires after 35 days to avoid stale data.
func (m *Meter) IncrementEvents(ctx context.Context, orgID string, count int) {
	if m.rdb == nil {
		return
	}
	key := fmt.Sprintf("usage:%s:%s", orgID, time.Now().UTC().Format("2006-01"))
	m.rdb.IncrBy(ctx, key, int64(count))
	m.rdb.Expire(ctx, key, 35*24*time.Hour) // Auto-expire after 35 days
}

// GetMonthlyUsage returns current month's event count for an org.
func (m *Meter) GetMonthlyUsage(ctx context.Context, orgID string) (int64, error) {
	if m.rdb == nil {
		return 0, nil
	}
	key := fmt.Sprintf("usage:%s:%s", orgID, time.Now().UTC().Format("2006-01"))
	val, err := m.rdb.Get(ctx, key).Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return val, err
}

// CheckLimit returns whether the org is within their plan's event limit,
// along with the current usage and the limit.
// A limit of -1 means unlimited.
func (m *Meter) CheckLimit(ctx context.Context, orgID, plan string) (bool, int64, int64) {
	limits, ok := middleware.PlanConfigs[plan]
	if !ok {
		limits = middleware.PlanConfigs["free"]
	}
	if limits.MaxEventsPerMonth < 0 {
		usage, _ := m.GetMonthlyUsage(ctx, orgID)
		return true, usage, -1 // unlimited
	}
	usage, _ := m.GetMonthlyUsage(ctx, orgID)
	return usage < int64(limits.MaxEventsPerMonth), usage, int64(limits.MaxEventsPerMonth)
}

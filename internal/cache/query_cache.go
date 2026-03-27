// Package cache provides a Redis-based query result cache for expensive ClickHouse queries.
package cache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// QueryCache is a Redis-based cache for expensive query results.
// All operations are non-blocking: a cache miss or Redis error results in
// a normal database query without any error propagation.
type QueryCache struct {
	rdb    *redis.Client
	prefix string
}

// NewQueryCache creates a new QueryCache backed by the given Redis client.
// If rdb is nil, all operations become no-ops (always miss).
func NewQueryCache(rdb *redis.Client) *QueryCache {
	return &QueryCache{rdb: rdb, prefix: "qc:"}
}

// Get retrieves a cached query result and unmarshals it into dest.
// Returns true if the value was found and successfully unmarshaled; false otherwise.
// A Redis error is treated as a cache miss (non-blocking).
func (c *QueryCache) Get(ctx context.Context, key string, dest interface{}) bool {
	if c.rdb == nil {
		return false
	}
	data, err := c.rdb.Get(ctx, c.prefix+key).Bytes()
	if err != nil {
		return false
	}
	return json.Unmarshal(data, dest) == nil
}

// Set stores a query result in the cache with the given TTL.
// Errors are silently ignored (non-blocking).
func (c *QueryCache) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) {
	if c.rdb == nil {
		return
	}
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	c.rdb.Set(ctx, c.prefix+key, data, ttl)
}

// Invalidate removes one or more cache keys.
// Errors are silently ignored (non-blocking).
func (c *QueryCache) Invalidate(ctx context.Context, keys ...string) {
	if c.rdb == nil || len(keys) == 0 {
		return
	}
	prefixed := make([]string, len(keys))
	for i, k := range keys {
		prefixed[i] = c.prefix + k
	}
	c.rdb.Del(ctx, prefixed...)
}

// Key generates a deterministic cache key from an org ID, query identifier,
// and variadic parameters. The result is a 16-character hex string derived
// from a SHA-256 hash of all inputs.
func Key(orgID string, query string, params ...interface{}) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s:%s", orgID, query)
	for _, p := range params {
		fmt.Fprintf(h, ":%v", p)
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

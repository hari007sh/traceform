package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/time/rate"
)

// RateLimiter provides Redis-based sliding window rate limiting
// with an in-memory fallback when Redis is unavailable.
type RateLimiter struct {
	client     *redis.Client
	localLimit *rate.Limiter // fallback when Redis is down
	limit      int
	window     time.Duration
}

// NewRateLimiter creates a new rate limiter.
func NewRateLimiter(client *redis.Client, limit int, window time.Duration) *RateLimiter {
	// Configure the in-memory fallback limiter.
	// rate.Limit converts requests-per-window to a per-second rate.
	perSecond := rate.Limit(float64(limit) / window.Seconds())
	return &RateLimiter{
		client:     client,
		localLimit: rate.NewLimiter(perSecond, limit),
		limit:      limit,
		window:     window,
	}
}

// RateLimit is a convenience constructor that returns chi-compatible middleware.
// Use it to apply different limits to different route groups.
func RateLimit(rdb *redis.Client, requestsPerMinute int) func(http.Handler) http.Handler {
	rl := NewRateLimiter(rdb, requestsPerMinute, time.Minute)
	return rl.Middleware()
}

// Middleware returns an HTTP middleware that enforces rate limiting.
func (rl *RateLimiter) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Use org_id from context if available, otherwise use IP
			identifier := GetOrgID(r.Context())
			if identifier == "" {
				identifier = r.RemoteAddr
			}

			key := fmt.Sprintf("ratelimit:%s", identifier)
			now := time.Now()

			ctx := r.Context()
			resetTime := now.Add(rl.window).Unix()

			allowed, remaining, err := rl.check(ctx, key, now)
			if err != nil {
				// Redis is down — fail closed using in-memory limiter.
				// Still set rate limit headers for observability.
				w.Header().Set("X-RateLimit-Limit", strconv.Itoa(rl.limit))
				w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resetTime, 10))
				if !rl.localLimit.Allow() {
					w.Header().Set("X-RateLimit-Remaining", "0")
					writeRateLimited(w)
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(rl.limit))
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resetTime, 10))

			if !allowed {
				writeRateLimited(w)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func (rl *RateLimiter) check(ctx context.Context, key string, now time.Time) (bool, int, error) {
	windowStart := now.Add(-rl.window)

	pipe := rl.client.Pipeline()
	// Remove old entries outside the window
	pipe.ZRemRangeByScore(ctx, key, "0", strconv.FormatInt(windowStart.UnixMicro(), 10))
	// Count entries in current window
	countCmd := pipe.ZCard(ctx, key)
	// Add current request
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(now.UnixMicro()), Member: now.UnixMicro()})
	// Set expiry on the key
	pipe.Expire(ctx, key, rl.window)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return false, 0, err
	}

	count := int(countCmd.Val())
	remaining := rl.limit - count - 1
	if remaining < 0 {
		remaining = 0
	}

	return count < rl.limit, remaining, nil
}

// writeRateLimited sends a 429 response.
func writeRateLimited(w http.ResponseWriter) {
	writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, please try again later")
}

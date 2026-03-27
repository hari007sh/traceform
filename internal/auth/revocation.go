package auth

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// TokenRevocation provides a Redis-based JWT blacklist.
// When a user logs out or an admin revokes a session, the JWT ID (jti) is added
// to the blacklist with a TTL matching the token's remaining lifetime.
type TokenRevocation struct {
	rdb *redis.Client
}

// NewTokenRevocation creates a new TokenRevocation backed by the given Redis client.
func NewTokenRevocation(rdb *redis.Client) *TokenRevocation {
	return &TokenRevocation{rdb: rdb}
}

// Revoke adds a JWT ID to the blacklist with TTL matching token expiry.
func (tr *TokenRevocation) Revoke(ctx context.Context, jti string, expiresAt time.Time) error {
	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		return nil // Already expired, no need to blacklist
	}
	return tr.rdb.Set(ctx, "revoked:"+jti, "1", ttl).Err()
}

// IsRevoked checks if a JWT ID has been revoked.
func (tr *TokenRevocation) IsRevoked(ctx context.Context, jti string) bool {
	exists, _ := tr.rdb.Exists(ctx, "revoked:"+jti).Result()
	return exists > 0
}

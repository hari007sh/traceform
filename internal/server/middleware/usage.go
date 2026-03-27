package middleware

import (
	"context"
	"fmt"
	"net/http"
)

// UsageLimitChecker is an interface for checking usage limits.
// This avoids an import cycle between middleware and billing packages.
type UsageLimitChecker interface {
	CheckLimit(ctx context.Context, orgID, plan string) (ok bool, usage int64, limit int64)
}

// UsageLimitCheck returns middleware that checks the org's monthly event usage
// against their plan limit before allowing ingest requests to proceed.
// If the org has exceeded their quota, a 429 Too Many Requests response is returned.
func UsageLimitCheck(checker UsageLimitChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			orgID := GetOrgID(r.Context())
			if orgID == "" {
				next.ServeHTTP(w, r)
				return
			}

			plan := GetOrgPlan(r.Context())
			ok, usage, limit := checker.CheckLimit(r.Context(), orgID, plan)
			if !ok {
				writeError(w, http.StatusTooManyRequests, "QUOTA_EXCEEDED",
					fmt.Sprintf("Monthly event limit reached: %d/%d events. Upgrade your plan.", usage, limit))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

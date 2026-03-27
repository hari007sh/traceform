package middleware

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

// OrgPlanKey is the context key for the authenticated organization's plan.
const OrgPlanKey contextKey = "org_plan"

// PlanLimits defines what each plan allows.
type PlanLimits struct {
	MaxEventsPerMonth int
	MaxTeamMembers    int
	MaxWebhooks       int
	MaxRetentionDays  int
	SSO               bool
	AuditLog          bool
	CustomRoles       bool
	DataExport        bool
	APIRateLimit      int // requests per minute
}

// PlanConfigs maps plan names to their limits.
var PlanConfigs = map[string]PlanLimits{
	"free": {
		MaxEventsPerMonth: 10000,
		MaxTeamMembers:    3,
		MaxWebhooks:       2,
		MaxRetentionDays:  7,
		SSO:               false,
		AuditLog:          false,
		CustomRoles:       false,
		DataExport:        false,
		APIRateLimit:      100,
	},
	"cloud": {
		MaxEventsPerMonth: 100000,
		MaxTeamMembers:    5,
		MaxWebhooks:       10,
		MaxRetentionDays:  30,
		SSO:               false,
		AuditLog:          true,
		CustomRoles:       false,
		DataExport:        true,
		APIRateLimit:      1000,
	},
	"team": {
		MaxEventsPerMonth: 1000000,
		MaxTeamMembers:    25,
		MaxWebhooks:       100,
		MaxRetentionDays:  90,
		SSO:               false,
		AuditLog:          true,
		CustomRoles:       false,
		DataExport:        true,
		APIRateLimit:      10000,
	},
	"enterprise": {
		MaxEventsPerMonth: -1, // unlimited
		MaxTeamMembers:    -1,
		MaxWebhooks:       -1,
		MaxRetentionDays:  365,
		SSO:               true,
		AuditLog:          true,
		CustomRoles:       true,
		DataExport:        true,
		APIRateLimit:      100000,
	},
}

// RequireFeature returns middleware that checks if the org's plan includes a feature.
func RequireFeature(feature string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			plan := GetOrgPlan(r.Context())
			limits, ok := PlanConfigs[plan]
			if !ok {
				limits = PlanConfigs["free"]
			}

			allowed := false
			switch feature {
			case "sso":
				allowed = limits.SSO
			case "audit_log":
				allowed = limits.AuditLog
			case "custom_roles":
				allowed = limits.CustomRoles
			case "data_export":
				allowed = limits.DataExport
			default:
				// Unknown feature — deny by default
				allowed = false
			}

			if !allowed {
				writeError(w, http.StatusForbidden, "PLAN_REQUIRED",
					"This feature requires an upgraded plan. Current plan: "+plan)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// OrgPlanLoader loads the org's plan into context, cached in Redis for 5 minutes.
func OrgPlanLoader(db *sql.DB, rdb *redis.Client) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			orgID := GetOrgID(r.Context())
			if orgID == "" {
				next.ServeHTTP(w, r)
				return
			}

			plan := "free"

			if rdb != nil {
				// Try Redis cache first
				cacheKey := "org:plan:" + orgID
				cached, err := rdb.Get(r.Context(), cacheKey).Result()
				if err == nil && cached != "" {
					plan = cached
					ctx := context.WithValue(r.Context(), OrgPlanKey, plan)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}

				// Cache miss — query DB
				err = db.QueryRowContext(r.Context(),
					"SELECT plan FROM organizations WHERE id = $1", orgID).Scan(&plan)
				if err != nil {
					plan = "free"
				}
				// Cache for 5 minutes, ignore errors
				rdb.Set(r.Context(), cacheKey, plan, 5*time.Minute)
			} else {
				// No Redis — query DB directly
				err := db.QueryRowContext(r.Context(),
					"SELECT plan FROM organizations WHERE id = $1", orgID).Scan(&plan)
				if err != nil {
					plan = "free"
				}
			}

			ctx := context.WithValue(r.Context(), OrgPlanKey, plan)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetOrgPlan extracts the organization plan from the request context.
func GetOrgPlan(ctx context.Context) string {
	if v, ok := ctx.Value(OrgPlanKey).(string); ok {
		return v
	}
	return "free"
}

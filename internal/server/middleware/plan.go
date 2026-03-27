package middleware

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/traceform/traceform/internal/license"
)

// OrgPlanKey is the context key for the authenticated organization's plan.
const OrgPlanKey contextKey = "org_plan"

// LicenseKey is the context key for the loaded license (self-hosted mode).
const LicenseKey contextKey = "license"

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

// featureTierMap documents the minimum tier needed for each gated feature,
// used for user-facing error messages.
var featureTierMap = map[string]string{
	"sso":                "enterprise",
	"custom_roles":       "enterprise",
	"audit_log":          "team",
	"data_export":        "team",
	"error_groups":       "team",
	"budget_enforcement": "team",
	"api_key_rotation":   "team",
}

// isSelfHosted returns true when the server is running in self-hosted mode
// (default) rather than cloud-hosted mode.
func isSelfHosted() bool {
	return os.Getenv("TRACEFORM_MODE") != "cloud"
}

// RequireFeature returns middleware that checks if the org's plan (cloud mode)
// or license (self-hosted mode) includes the requested feature.
func RequireFeature(feature string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isSelfHosted() {
				// Self-hosted: check the license from context
				lic := GetLicenseFromContext(r.Context())
				if lic != nil && lic.HasFeature(feature) {
					next.ServeHTTP(w, r)
					return
				}
				tier := "community"
				if lic != nil {
					tier = lic.Tier
				}
				requiredTier := featureTierMap[feature]
				if requiredTier == "" {
					requiredTier = "team"
				}
				writeError(w, http.StatusForbidden, "LICENSE_REQUIRED",
					fmt.Sprintf("This feature requires a %s license. Current: %s. Visit https://traceform.dev/pricing to upgrade.", requiredTier, tier))
				return
			}

			// Cloud mode: use the database-backed plan
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

// LicenseInjector returns middleware that injects the given license into
// every request context. This is applied once at server startup so all
// downstream handlers and middleware can access it.
func LicenseInjector(lic *license.License) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), LicenseKey, lic)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetLicenseFromContext extracts the license from the request context.
func GetLicenseFromContext(ctx context.Context) *license.License {
	if v, ok := ctx.Value(LicenseKey).(*license.License); ok {
		return v
	}
	return nil
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

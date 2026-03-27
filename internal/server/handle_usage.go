package server

import (
	"net/http"

	"github.com/agentstack/agentstack/internal/server/middleware"
)

// usageResponse is the JSON response for the /api/usage endpoint.
type usageResponse struct {
	Plan             string `json:"plan"`
	EventsThisMonth  int64  `json:"events_this_month"`
	EventsLimit      int64  `json:"events_limit"`
	UsagePercent     int    `json:"usage_percent"`
	TeamMembers      int    `json:"team_members"`
	TeamLimit        int    `json:"team_limit"`
	Webhooks         int    `json:"webhooks"`
	WebhooksLimit    int    `json:"webhooks_limit"`
	RetentionDays    int    `json:"retention_days"`
	APIRateLimit     int    `json:"api_rate_limit"`
	Features         usageFeatures `json:"features"`
}

type usageFeatures struct {
	SSO         bool `json:"sso"`
	AuditLog    bool `json:"audit_log"`
	DataExport  bool `json:"data_export"`
	CustomRoles bool `json:"custom_roles"`
}

// handleGetUsage returns usage and plan information for the current org.
func (s *Server) handleGetUsage(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	// Get the org's plan from context (loaded by OrgPlanLoader middleware)
	plan := middleware.GetOrgPlan(r.Context())

	limits, ok := middleware.PlanConfigs[plan]
	if !ok {
		limits = middleware.PlanConfigs["free"]
		plan = "free"
	}

	// Get monthly event usage from metering
	var eventsThisMonth int64
	if s.meter != nil {
		eventsThisMonth, _ = s.meter.GetMonthlyUsage(r.Context(), orgID)
	}

	// Calculate usage percent
	usagePercent := 0
	eventsLimit := int64(limits.MaxEventsPerMonth)
	if eventsLimit > 0 {
		usagePercent = int(eventsThisMonth * 100 / eventsLimit)
		if usagePercent > 100 {
			usagePercent = 100
		}
	}

	// Get team member count
	var memberCount int
	err := s.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM users WHERE org_id = $1`, orgID,
	).Scan(&memberCount)
	if err != nil {
		memberCount = 0
	}

	// Get webhook count
	var webhookCount int
	err = s.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM webhook_endpoints WHERE org_id = $1`, orgID,
	).Scan(&webhookCount)
	if err != nil {
		webhookCount = 0
	}

	resp := usageResponse{
		Plan:            plan,
		EventsThisMonth: eventsThisMonth,
		EventsLimit:     eventsLimit,
		UsagePercent:    usagePercent,
		TeamMembers:     memberCount,
		TeamLimit:       limits.MaxTeamMembers,
		Webhooks:        webhookCount,
		WebhooksLimit:   limits.MaxWebhooks,
		RetentionDays:   limits.MaxRetentionDays,
		APIRateLimit:    limits.APIRateLimit,
		Features: usageFeatures{
			SSO:         limits.SSO,
			AuditLog:    limits.AuditLog,
			DataExport:  limits.DataExport,
			CustomRoles: limits.CustomRoles,
		},
	}

	WriteJSON(w, http.StatusOK, resp)
}

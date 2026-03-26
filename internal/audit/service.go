package audit

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/agentstack/agentstack/internal/server/middleware"
)

// Logger provides async, fire-and-forget audit logging.
type Logger struct {
	store  *Store
	logger *slog.Logger
}

// NewLogger creates a new audit Logger backed by the given store.
func NewLogger(store *Store, logger *slog.Logger) *Logger {
	return &Logger{store: store, logger: logger}
}

// Log records an audit event asynchronously. It extracts org_id, user_id,
// email, IP, and user-agent from the request and runs the insert in a
// background goroutine so that the caller is never blocked.
func (l *Logger) Log(r *http.Request, action, resourceType, resourceID string, details map[string]interface{}) {
	orgID := middleware.GetOrgID(r.Context())
	userID := middleware.GetUserID(r.Context())
	email := middleware.GetUserEmail(r.Context())
	ip := middleware.GetClientIP(r)
	ua := r.UserAgent()

	var detailsJSON json.RawMessage
	if details != nil {
		b, err := json.Marshal(details)
		if err != nil {
			l.logger.Error("audit: failed to marshal details", "error", err)
			detailsJSON = json.RawMessage(`{}`)
		} else {
			detailsJSON = b
		}
	} else {
		detailsJSON = json.RawMessage(`{}`)
	}

	entry := Entry{
		OrgID:        orgID,
		UserID:       userID,
		UserEmail:    email,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Details:      detailsJSON,
		IPAddress:    ip,
		UserAgent:    ua,
	}

	// Fire-and-forget: use background context so the insert is not cancelled
	// when the HTTP handler returns.
	go func() {
		if err := l.store.Insert(context.Background(), entry); err != nil {
			l.logger.Error("audit: failed to insert log entry",
				"error", err,
				"action", action,
				"resource_type", resourceType,
				"resource_id", resourceID,
				"org_id", orgID,
			)
		}
	}()
}

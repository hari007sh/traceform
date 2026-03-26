package middleware

import (
	"context"
	"net/http"
)

// roleHierarchy defines the permission level for each role.
// Higher levels have more permissions.
var roleHierarchy = map[string]int{
	"viewer": 1,
	"member": 1,
	"admin":  2,
	"owner":  3,
}

// RequireRole returns middleware that enforces a minimum role level.
// It checks the user_role context value set by JWTAuth or DualAuth.
// API key authenticated requests are treated as admin level.
func RequireRole(minRole string) func(http.Handler) http.Handler {
	minLevel := roleHierarchy[minRole]
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userRole := getUserRole(r.Context())
			userLevel, ok := roleHierarchy[userRole]
			if !ok || userLevel < minLevel {
				writeError(w, http.StatusForbidden, "FORBIDDEN",
					"insufficient permissions: requires "+minRole+" role")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// getUserRole extracts the user role from the request context.
// If the request was authenticated via API key (no JWT role), it defaults to "admin".
func getUserRole(ctx context.Context) string {
	if v, ok := ctx.Value(UserRoleKey).(string); ok {
		return v
	}
	// API key authenticated requests get admin level access
	if v, ok := ctx.Value(APIKeyIDKey).(string); ok && v != "" {
		return "admin"
	}
	return ""
}

package server

import (
	"net/http"
	"strings"

	"github.com/agentstack/agentstack/internal/server/middleware"
)

// handleLogout revokes the current JWT token by adding its JTI to the Redis blacklist.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if s.tokenRevocation == nil {
		WriteError(w, http.StatusServiceUnavailable, "REVOCATION_UNAVAILABLE", "token revocation is not available")
		return
	}

	// Extract the token from the Authorization header to get the claims
	authHeader := r.Header.Get("Authorization")
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 {
		WriteError(w, http.StatusBadRequest, "INVALID_TOKEN", "missing authorization token")
		return
	}
	tokenStr := strings.TrimSpace(parts[1])

	claims, err := s.jwtManager.ValidateToken(tokenStr)
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "INVALID_TOKEN", "invalid or expired token")
		return
	}

	jti := claims.ID
	if jti == "" {
		// Token was generated before JTI support was added
		WriteError(w, http.StatusBadRequest, "NO_JTI", "token does not have a revocable ID")
		return
	}

	if err := s.tokenRevocation.Revoke(r.Context(), jti, claims.ExpiresAt.Time); err != nil {
		s.logger.Error("failed to revoke token", "error", err, "jti", jti)
		WriteError(w, http.StatusInternalServerError, "REVOCATION_ERROR", "failed to revoke token")
		return
	}

	s.auditLogger.Log(r, "logout", "session", jti, map[string]interface{}{
		"user_id": middleware.GetUserID(r.Context()),
		"email":   middleware.GetUserEmail(r.Context()),
	})

	WriteJSON(w, http.StatusOK, map[string]string{
		"message": "successfully logged out",
	})
}

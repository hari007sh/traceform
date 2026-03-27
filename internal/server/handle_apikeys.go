package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/traceform/traceform/internal/auth"
	"github.com/traceform/traceform/internal/server/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/lib/pq"
)

// apiKeyResponse is the JSON response for a single API key (without the raw key).
type apiKeyResponse struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	KeyPrefix   string   `json:"key_prefix"`
	Permissions []string `json:"permissions"`
	LastUsedAt  *string  `json:"last_used_at"`
	ExpiresAt   *string  `json:"expires_at"`
	CreatedAt   string   `json:"created_at"`
	CreatedBy   *string  `json:"created_by"`
}

// apiKeyCreateRequest is the JSON body for creating an API key.
type apiKeyCreateRequest struct {
	Name        string   `json:"name"`
	Permissions []string `json:"permissions"`
	ExpiresIn   *int     `json:"expires_in"` // days until expiration, nil = no expiry
}

// apiKeyCreateResponse includes the raw key (shown only once).
type apiKeyCreateResponse struct {
	apiKeyResponse
	Key string `json:"key"`
}

// handleListAPIKeys returns all API keys for the current org.
func (s *Server) handleListAPIKeys(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	rows, err := s.db.QueryContext(r.Context(),
		`SELECT id, name, key_prefix, permissions, last_used_at, expires_at, created_at, created_by
		 FROM api_keys
		 WHERE org_id = $1
		 ORDER BY created_at DESC`,
		orgID,
	)
	if err != nil {
		s.logger.Error("failed to list API keys", "error", err, "org_id", orgID)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to list API keys")
		return
	}
	defer rows.Close()

	keys := []apiKeyResponse{}
	for rows.Next() {
		var k apiKeyResponse
		var lastUsed, expires *time.Time
		var createdAt time.Time
		var createdBy *string
		var perms []string

		err := rows.Scan(&k.ID, &k.Name, &k.KeyPrefix, pq.Array(&perms), &lastUsed, &expires, &createdAt, &createdBy)
		if err != nil {
			s.logger.Error("failed to scan API key", "error", err)
			continue
		}

		k.Permissions = perms
		if k.Permissions == nil {
			k.Permissions = []string{}
		}
		k.CreatedAt = createdAt.Format(time.RFC3339)
		k.CreatedBy = createdBy
		if lastUsed != nil {
			t := lastUsed.Format(time.RFC3339)
			k.LastUsedAt = &t
		}
		if expires != nil {
			t := expires.Format(time.RFC3339)
			k.ExpiresAt = &t
		}
		keys = append(keys, k)
	}

	WriteJSON(w, http.StatusOK, keys)
}

// handleCreateAPIKey creates a new API key for the current org.
func (s *Server) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	userID := middleware.GetUserID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	var req apiKeyCreateRequest
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		WriteError(w, http.StatusBadRequest, "INVALID_NAME", "API key name is required")
		return
	}

	// Generate the key
	rawKey, err := auth.GenerateAPIKey()
	if err != nil {
		s.logger.Error("failed to generate API key", "error", err)
		WriteError(w, http.StatusInternalServerError, "GENERATE_ERROR", "failed to generate API key")
		return
	}

	keyHash := auth.HashAPIKey(rawKey)
	keyPrefix := auth.KeyPrefix(rawKey)

	// Default permissions
	perms := req.Permissions
	if len(perms) == 0 {
		perms = []string{"read", "write"}
	}

	// Compute expiration
	var expiresAt *time.Time
	if req.ExpiresIn != nil && *req.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(*req.ExpiresIn) * 24 * time.Hour)
		expiresAt = &t
	}

	// Determine created_by (might be nil if auth was via API key)
	var createdBy *string
	if userID != "" {
		createdBy = &userID
	}

	var keyID string
	var createdAt time.Time
	err = s.db.QueryRowContext(r.Context(),
		`INSERT INTO api_keys (org_id, name, key_hash, key_prefix, permissions, expires_at, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, created_at`,
		orgID, name, keyHash, keyPrefix, pq.Array(perms), expiresAt, createdBy,
	).Scan(&keyID, &createdAt)
	if err != nil {
		s.logger.Error("failed to insert API key", "error", err, "org_id", orgID)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to create API key")
		return
	}

	s.auditLogger.Log(r, "created", "api_key", keyID, map[string]interface{}{
		"name":       name,
		"key_prefix": keyPrefix,
	})

	resp := apiKeyCreateResponse{
		apiKeyResponse: apiKeyResponse{
			ID:          keyID,
			Name:        name,
			KeyPrefix:   keyPrefix,
			Permissions: perms,
			CreatedAt:   createdAt.Format(time.RFC3339),
			CreatedBy:   createdBy,
		},
		Key: rawKey,
	}
	if expiresAt != nil {
		t := expiresAt.Format(time.RFC3339)
		resp.ExpiresAt = &t
	}

	WriteJSON(w, http.StatusCreated, resp)
}

// handleRotateAPIKey creates a new key with the same name and permissions,
// marks the old key with a 24-hour grace period, then returns the new key.
func (s *Server) handleRotateAPIKey(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	userID := middleware.GetUserID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	keyID := chi.URLParam(r, "id")
	if keyID == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_ID", "API key ID is required")
		return
	}

	// 1. Get existing key metadata
	var oldName string
	var oldPerms []string
	err := s.db.QueryRowContext(r.Context(),
		`SELECT name, permissions FROM api_keys WHERE id = $1 AND org_id = $2`,
		keyID, orgID,
	).Scan(&oldName, pq.Array(&oldPerms))
	if err != nil {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "API key not found")
		return
	}

	// 2. Generate new key
	rawKey, err := auth.GenerateAPIKey()
	if err != nil {
		s.logger.Error("failed to generate API key for rotation", "error", err)
		WriteError(w, http.StatusInternalServerError, "GENERATE_ERROR", "failed to generate new API key")
		return
	}

	keyHash := auth.HashAPIKey(rawKey)
	keyPrefix := auth.KeyPrefix(rawKey)

	// Use transaction to ensure atomicity
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		s.logger.Error("failed to begin transaction for key rotation", "error", err)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to start key rotation")
		return
	}
	defer tx.Rollback()

	// 3. Insert new key with same name + " (rotated)" suffix
	newName := oldName + " (rotated)"
	var createdBy *string
	if userID != "" {
		createdBy = &userID
	}

	var newKeyID string
	var createdAt time.Time
	err = tx.QueryRowContext(r.Context(),
		`INSERT INTO api_keys (org_id, name, key_hash, key_prefix, permissions, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, created_at`,
		orgID, newName, keyHash, keyPrefix, pq.Array(oldPerms), createdBy,
	).Scan(&newKeyID, &createdAt)
	if err != nil {
		s.logger.Error("failed to insert rotated API key", "error", err, "org_id", orgID)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to create rotated API key")
		return
	}

	// 4. Mark old key expires_at = now + 24h (grace period)
	gracePeriod := time.Now().Add(24 * time.Hour)
	_, err = tx.ExecContext(r.Context(),
		`UPDATE api_keys SET expires_at = $1 WHERE id = $2 AND org_id = $3`,
		gracePeriod, keyID, orgID,
	)
	if err != nil {
		s.logger.Error("failed to set grace period on old API key", "error", err, "key_id", keyID)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to set grace period on old key")
		return
	}

	if err := tx.Commit(); err != nil {
		s.logger.Error("failed to commit key rotation", "error", err)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to complete key rotation")
		return
	}

	// 6. Audit log the rotation
	s.auditLogger.Log(r, "rotated", "api_key", keyID, map[string]interface{}{
		"old_key_id":        keyID,
		"new_key_id":        newKeyID,
		"new_key_prefix":    keyPrefix,
		"grace_period_ends": gracePeriod.Format(time.RFC3339),
	})

	// 5. Return new key (shown only once)
	perms := oldPerms
	if perms == nil {
		perms = []string{}
	}
	graceStr := gracePeriod.Format(time.RFC3339)

	resp := struct {
		apiKeyCreateResponse
		OldKeyID        string `json:"old_key_id"`
		GracePeriodEnds string `json:"grace_period_ends"`
	}{
		apiKeyCreateResponse: apiKeyCreateResponse{
			apiKeyResponse: apiKeyResponse{
				ID:          newKeyID,
				Name:        newName,
				KeyPrefix:   keyPrefix,
				Permissions: perms,
				CreatedAt:   createdAt.Format(time.RFC3339),
				CreatedBy:   createdBy,
			},
			Key: rawKey,
		},
		OldKeyID:        keyID,
		GracePeriodEnds: graceStr,
	}

	WriteJSON(w, http.StatusCreated, resp)
}

// handleDeleteAPIKey revokes (deletes) an API key.
func (s *Server) handleDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	keyID := chi.URLParam(r, "id")
	if keyID == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_ID", "API key ID is required")
		return
	}

	result, err := s.db.ExecContext(r.Context(),
		`DELETE FROM api_keys WHERE id = $1 AND org_id = $2`,
		keyID, orgID,
	)
	if err != nil {
		s.logger.Error("failed to delete API key", "error", err, "key_id", keyID, "org_id", orgID)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to delete API key")
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "API key not found")
		return
	}

	s.auditLogger.Log(r, "deleted", "api_key", keyID, nil)

	w.WriteHeader(http.StatusNoContent)
}

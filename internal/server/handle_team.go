package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/traceform/traceform/internal/server/middleware"
)

// teamMemberResponse is the JSON response for a team member.
type teamMemberResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// teamInviteRequest is the JSON body for inviting a new team member.
type teamInviteRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

// teamRoleUpdateRequest is the JSON body for updating a team member's role.
type teamRoleUpdateRequest struct {
	Role string `json:"role"`
}

// inviteResponse is the JSON response for an invite.
type inviteResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	InviteURL string `json:"invite_url"`
	Status    string `json:"status"`
	ExpiresAt string `json:"expires_at"`
	CreatedAt string `json:"created_at"`
}

// teamInfoResponse wraps team members with limit metadata.
type teamInfoResponse struct {
	Members    []teamMemberResponse `json:"members"`
	MemberCount int                 `json:"member_count"`
	MemberLimit int                 `json:"member_limit"`
}

// getMemberLimit returns the maximum number of team members allowed for the
// current org, considering license (self-hosted) and plan (cloud) modes.
func (s *Server) getMemberLimit(r *http.Request) int {
	// Cloud mode: check plan config
	if os.Getenv("TRACEFORM_MODE") == "cloud" {
		plan := middleware.GetOrgPlan(r.Context())
		limits, ok := middleware.PlanConfigs[plan]
		if ok {
			return limits.MaxTeamMembers
		}
		return middleware.PlanConfigs["free"].MaxTeamMembers
	}

	// Self-hosted: check license
	lic := middleware.GetLicenseFromContext(r.Context())
	if lic != nil {
		return lic.MaxMembers
	}
	return 3 // community default
}

// handleListTeam returns all users in the current org along with limit info.
func (s *Server) handleListTeam(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	rows, err := s.db.QueryContext(r.Context(),
		`SELECT id, email, name, avatar_url, role, created_at, updated_at
		 FROM users
		 WHERE org_id = $1
		 ORDER BY created_at ASC`,
		orgID,
	)
	if err != nil {
		s.logger.Error("failed to list team members", "error", err, "org_id", orgID)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to list team members")
		return
	}
	defer rows.Close()

	members := []teamMemberResponse{}
	for rows.Next() {
		var m teamMemberResponse
		var createdAt, updatedAt time.Time
		err := rows.Scan(&m.ID, &m.Email, &m.Name, &m.AvatarURL, &m.Role, &createdAt, &updatedAt)
		if err != nil {
			s.logger.Error("failed to scan team member", "error", err)
			continue
		}
		m.CreatedAt = createdAt.Format(time.RFC3339)
		m.UpdatedAt = updatedAt.Format(time.RFC3339)
		members = append(members, m)
	}

	maxMembers := s.getMemberLimit(r)

	WriteJSON(w, http.StatusOK, teamInfoResponse{
		Members:     members,
		MemberCount: len(members),
		MemberLimit: maxMembers,
	})
}

// handleInviteTeamMember creates an invite (not a user) and returns an invite URL.
func (s *Server) handleInviteTeamMember(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	userID := middleware.GetUserID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	var req teamInviteRequest
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	// Validate email
	email := strings.TrimSpace(req.Email)
	if email == "" || !strings.Contains(email, "@") {
		WriteError(w, http.StatusBadRequest, "INVALID_EMAIL", "a valid email address is required")
		return
	}

	// Validate name
	name := strings.TrimSpace(req.Name)
	if name == "" {
		WriteError(w, http.StatusBadRequest, "INVALID_NAME", "name is required")
		return
	}

	// Validate role
	role := strings.TrimSpace(req.Role)
	if role == "" {
		role = "member"
	}
	if role != "owner" && role != "admin" && role != "member" {
		WriteError(w, http.StatusBadRequest, "INVALID_ROLE", "role must be one of: owner, admin, member")
		return
	}

	// --- Member limit enforcement ---
	maxMembers := s.getMemberLimit(r)
	if maxMembers > 0 { // -1 = unlimited
		var count int
		err := s.db.QueryRowContext(r.Context(),
			"SELECT count(*) FROM users WHERE org_id = $1", orgID).Scan(&count)
		if err != nil {
			s.logger.Error("failed to count members", "error", err, "org_id", orgID)
			WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to check member count")
			return
		}
		if count >= maxMembers {
			WriteError(w, http.StatusForbidden, "MEMBER_LIMIT",
				fmt.Sprintf("Your plan allows %d team members. Current: %d. Upgrade to add more.", maxMembers, count))
			return
		}
	}

	// Check for duplicate email within the org (already a member)
	var exists bool
	err := s.db.QueryRowContext(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 AND org_id = $2)`,
		email, orgID,
	).Scan(&exists)
	if err != nil {
		s.logger.Error("failed to check duplicate email", "error", err)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to check for existing member")
		return
	}
	if exists {
		WriteError(w, http.StatusConflict, "DUPLICATE_EMAIL", "a team member with this email already exists")
		return
	}

	// Check for existing pending invite for this email in this org
	var pendingExists bool
	err = s.db.QueryRowContext(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM invites WHERE email = $1 AND org_id = $2 AND status = 'pending' AND expires_at > NOW())`,
		email, orgID,
	).Scan(&pendingExists)
	if err != nil {
		s.logger.Error("failed to check pending invite", "error", err)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to check for pending invite")
		return
	}
	if pendingExists {
		WriteError(w, http.StatusConflict, "DUPLICATE_INVITE", "a pending invite for this email already exists")
		return
	}

	// Generate invite token (random 32-byte hex string)
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		s.logger.Error("failed to generate invite token", "error", err)
		WriteError(w, http.StatusInternalServerError, "TOKEN_ERROR", "failed to generate invite token")
		return
	}
	token := hex.EncodeToString(tokenBytes)

	// Set expiry (7 days)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	// Insert invite
	var inviteID string
	var createdAt time.Time
	err = s.db.QueryRowContext(r.Context(),
		`INSERT INTO invites (org_id, email, name, role, token, invited_by, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, created_at`,
		orgID, email, name, role, token, userID, expiresAt,
	).Scan(&inviteID, &createdAt)
	if err != nil {
		s.logger.Error("failed to create invite", "error", err, "org_id", orgID)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to create invite")
		return
	}

	// Build invite URL
	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		frontendURL = "http://localhost:3001"
	}
	inviteURL := fmt.Sprintf("%s/invite/%s", frontendURL, token)

	// Audit log
	s.auditLogger.Log(r, "invited", "team_member", inviteID, map[string]interface{}{
		"email":      email,
		"role":       role,
		"invite_url": inviteURL,
	})

	WriteJSON(w, http.StatusCreated, inviteResponse{
		ID:        inviteID,
		Email:     email,
		Name:      name,
		Role:      role,
		InviteURL: inviteURL,
		Status:    "pending",
		ExpiresAt: expiresAt.Format(time.RFC3339),
		CreatedAt: createdAt.Format(time.RFC3339),
	})
}

// handleListInvites returns all invites for the current org.
func (s *Server) handleListInvites(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	rows, err := s.db.QueryContext(r.Context(),
		`SELECT id, email, name, role, status, expires_at, created_at
		 FROM invites
		 WHERE org_id = $1
		 ORDER BY created_at DESC`,
		orgID,
	)
	if err != nil {
		s.logger.Error("failed to list invites", "error", err, "org_id", orgID)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to list invites")
		return
	}
	defer rows.Close()

	invites := []inviteResponse{}
	for rows.Next() {
		var inv inviteResponse
		var expiresAt, createdAt time.Time
		err := rows.Scan(&inv.ID, &inv.Email, &inv.Name, &inv.Role, &inv.Status, &expiresAt, &createdAt)
		if err != nil {
			s.logger.Error("failed to scan invite", "error", err)
			continue
		}
		inv.ExpiresAt = expiresAt.Format(time.RFC3339)
		inv.CreatedAt = createdAt.Format(time.RFC3339)

		// Auto-expire if past expiry
		if inv.Status == "pending" && time.Now().After(expiresAt) {
			inv.Status = "expired"
		}

		invites = append(invites, inv)
	}

	WriteJSON(w, http.StatusOK, invites)
}

// handleCancelInvite cancels (deletes) a pending invite.
func (s *Server) handleCancelInvite(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	inviteID := chi.URLParam(r, "id")
	if inviteID == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_ID", "invite ID is required")
		return
	}

	result, err := s.db.ExecContext(r.Context(),
		`DELETE FROM invites WHERE id = $1 AND org_id = $2 AND status = 'pending'`,
		inviteID, orgID,
	)
	if err != nil {
		s.logger.Error("failed to cancel invite", "error", err, "invite_id", inviteID)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to cancel invite")
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "invite not found or already accepted/expired")
		return
	}

	s.auditLogger.Log(r, "cancelled", "invite", inviteID, nil)

	w.WriteHeader(http.StatusNoContent)
}

// handleAcceptInvite handles GET /auth/invite/{token} — validates the invite
// and redirects the user to the login page with invite context.
func (s *Server) handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		frontendURL := os.Getenv("FRONTEND_URL")
		if frontendURL == "" {
			frontendURL = "http://localhost:3001"
		}
		http.Redirect(w, r, frontendURL+"/invite/invalid", http.StatusFound)
		return
	}

	var inviteID, orgID, email, inviteName, role, status string
	var expiresAt time.Time
	err := s.db.QueryRowContext(r.Context(),
		`SELECT id, org_id, email, name, role, expires_at, status
		 FROM invites WHERE token = $1`, token,
	).Scan(&inviteID, &orgID, &email, &inviteName, &role, &expiresAt, &status)

	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		frontendURL = "http://localhost:3001"
	}

	if err != nil || status != "pending" {
		http.Redirect(w, r, frontendURL+"/invite/invalid", http.StatusFound)
		return
	}

	if time.Now().After(expiresAt) {
		// Mark expired
		_, _ = s.db.ExecContext(r.Context(),
			"UPDATE invites SET status = 'expired' WHERE id = $1", inviteID)
		http.Redirect(w, r, frontendURL+"/invite/expired", http.StatusFound)
		return
	}

	// Redirect to login page with invite context
	http.Redirect(w, r, fmt.Sprintf("%s/login?invite=%s&email=%s", frontendURL, token, email), http.StatusFound)
}

// handleGetInviteInfo returns invite details for a given token (public, no auth required).
// Used by the frontend invite accept page to display invite info.
func (s *Server) handleGetInviteInfo(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_TOKEN", "invite token is required")
		return
	}

	var inviteID, orgID, email, inviteName, role, status string
	var expiresAt, createdAt time.Time
	err := s.db.QueryRowContext(r.Context(),
		`SELECT i.id, i.org_id, i.email, i.name, i.role, i.expires_at, i.status, i.created_at
		 FROM invites i WHERE i.token = $1`, token,
	).Scan(&inviteID, &orgID, &email, &inviteName, &role, &expiresAt, &status, &createdAt)
	if err != nil {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "invite not found")
		return
	}

	// Auto-expire
	if status == "pending" && time.Now().After(expiresAt) {
		status = "expired"
		_, _ = s.db.ExecContext(r.Context(),
			"UPDATE invites SET status = 'expired' WHERE id = $1", inviteID)
	}

	// Get org name
	var orgName string
	_ = s.db.QueryRowContext(r.Context(),
		"SELECT name FROM organizations WHERE id = $1", orgID,
	).Scan(&orgName)

	// Get inviter name
	var inviterName string
	_ = s.db.QueryRowContext(r.Context(),
		`SELECT u.name FROM users u
		 JOIN invites i ON i.invited_by = u.id
		 WHERE i.id = $1`, inviteID,
	).Scan(&inviterName)

	WriteJSON(w, http.StatusOK, map[string]interface{}{
		"id":           inviteID,
		"email":        email,
		"name":         inviteName,
		"role":         role,
		"status":       status,
		"org_name":     orgName,
		"invited_by":   inviterName,
		"expires_at":   expiresAt.Format(time.RFC3339),
		"created_at":   createdAt.Format(time.RFC3339),
	})
}

// acceptInviteForUser is called after OAuth to accept a pending invite
// for the given email. It assigns the user to the invite's org with the
// invite's role. Returns (orgID, role, accepted) — if no invite exists,
// accepted is false.
func (s *Server) acceptInviteForUser(ctx context.Context, userEmail string, userID string) (string, string, bool) {
	var inviteID, orgID, role string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, org_id, role FROM invites
		 WHERE email = $1 AND status = 'pending' AND expires_at > NOW()
		 ORDER BY created_at DESC LIMIT 1`, userEmail,
	).Scan(&inviteID, &orgID, &role)
	if err != nil {
		return "", "", false
	}

	// Update the user to belong to the invite's org with the invite's role
	_, err = s.db.ExecContext(ctx,
		`UPDATE users SET org_id = $1, role = $2, updated_at = NOW() WHERE id = $3`,
		orgID, role, userID,
	)
	if err != nil {
		s.logger.Error("failed to assign user to invited org", "error", err, "user_id", userID, "org_id", orgID)
		return "", "", false
	}

	// Mark invite as accepted
	_, _ = s.db.ExecContext(ctx,
		`UPDATE invites SET status = 'accepted', accepted_at = NOW() WHERE id = $1`, inviteID)

	return orgID, role, true
}

// handleUpdateTeamMemberRole updates a team member's role.
func (s *Server) handleUpdateTeamMemberRole(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	userID := middleware.GetUserID(r.Context())
	if orgID == "" || userID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization or user context")
		return
	}

	memberID := chi.URLParam(r, "id")
	if memberID == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_ID", "team member ID is required")
		return
	}

	// Prevent changing your own role
	if memberID == userID {
		WriteError(w, http.StatusBadRequest, "SELF_ROLE_CHANGE", "you cannot change your own role")
		return
	}

	var req teamRoleUpdateRequest
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	role := strings.TrimSpace(req.Role)
	if role != "owner" && role != "admin" && role != "member" {
		WriteError(w, http.StatusBadRequest, "INVALID_ROLE", "role must be one of: owner, admin, member")
		return
	}

	// Verify the target member belongs to the same org
	var currentRole string
	err := s.db.QueryRowContext(r.Context(),
		`SELECT role FROM users WHERE id = $1 AND org_id = $2`,
		memberID, orgID,
	).Scan(&currentRole)
	if err != nil {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "team member not found")
		return
	}

	// Update the role
	result, err := s.db.ExecContext(r.Context(),
		`UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
		role, memberID, orgID,
	)
	if err != nil {
		s.logger.Error("failed to update team member role", "error", err, "member_id", memberID)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to update team member role")
		return
	}

	rowsAff, _ := result.RowsAffected()
	if rowsAff == 0 {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "team member not found")
		return
	}

	// Return updated member
	var m teamMemberResponse
	var createdAt, updatedAt time.Time
	err = s.db.QueryRowContext(r.Context(),
		`SELECT id, email, name, avatar_url, role, created_at, updated_at
		 FROM users WHERE id = $1 AND org_id = $2`,
		memberID, orgID,
	).Scan(&m.ID, &m.Email, &m.Name, &m.AvatarURL, &m.Role, &createdAt, &updatedAt)
	if err != nil {
		s.logger.Error("failed to fetch updated team member", "error", err)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to fetch updated team member")
		return
	}
	m.CreatedAt = createdAt.Format(time.RFC3339)
	m.UpdatedAt = updatedAt.Format(time.RFC3339)

	s.auditLogger.Log(r, "updated_role", "team_member", memberID, map[string]interface{}{
		"previous_role": currentRole,
		"new_role":      role,
	})

	WriteJSON(w, http.StatusOK, m)
}

// handleRemoveTeamMember removes a team member from the org.
func (s *Server) handleRemoveTeamMember(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	userID := middleware.GetUserID(r.Context())
	if orgID == "" || userID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization or user context")
		return
	}

	memberID := chi.URLParam(r, "id")
	if memberID == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_ID", "team member ID is required")
		return
	}

	// Prevent self-deletion
	if memberID == userID {
		WriteError(w, http.StatusBadRequest, "SELF_DELETE", "you cannot remove yourself from the team")
		return
	}

	// Check the target member exists and get their role
	var targetRole string
	err := s.db.QueryRowContext(r.Context(),
		`SELECT role FROM users WHERE id = $1 AND org_id = $2`,
		memberID, orgID,
	).Scan(&targetRole)
	if err != nil {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "team member not found")
		return
	}

	// Prevent deleting the last owner
	if targetRole == "owner" {
		var ownerCount int
		err = s.db.QueryRowContext(r.Context(),
			`SELECT COUNT(*) FROM users WHERE org_id = $1 AND role = 'owner'`,
			orgID,
		).Scan(&ownerCount)
		if err != nil {
			s.logger.Error("failed to count owners", "error", err, "org_id", orgID)
			WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to verify owner count")
			return
		}
		if ownerCount <= 1 {
			WriteError(w, http.StatusBadRequest, "LAST_OWNER", "cannot remove the last owner of the organization")
			return
		}
	}

	// Delete the member
	result, err := s.db.ExecContext(r.Context(),
		`DELETE FROM users WHERE id = $1 AND org_id = $2`,
		memberID, orgID,
	)
	if err != nil {
		s.logger.Error("failed to remove team member", "error", err, "member_id", memberID, "org_id", orgID)
		WriteError(w, http.StatusInternalServerError, "DB_ERROR", "failed to remove team member")
		return
	}

	rowsAff, _ := result.RowsAffected()
	if rowsAff == 0 {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "team member not found")
		return
	}

	s.auditLogger.Log(r, "removed", "team_member", memberID, map[string]interface{}{
		"role": targetRole,
	})

	w.WriteHeader(http.StatusNoContent)
}

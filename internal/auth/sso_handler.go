package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/agentstack/agentstack/internal/route/service"
	"github.com/agentstack/agentstack/internal/server/httputil"
	"github.com/go-chi/chi/v5"
)

// contextKey type mirrors the middleware package's context key type
// to avoid an import cycle (middleware imports auth).
type contextKey string

// getOrgIDFromContext extracts the organization ID from the request context.
// It uses the same context key as middleware.OrgIDKey ("org_id").
func getOrgIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(contextKey("org_id")).(string); ok {
		return v
	}
	return ""
}

// SSOHandler handles all SSO-related HTTP endpoints.
type SSOHandler struct {
	store      *SSOStore
	jwt        *JWTManager
	encryption *service.Encryption
	logger     *slog.Logger
	db         *sql.DB
	baseURL    string
}

// NewSSOHandler creates a new SSO handler.
func NewSSOHandler(store *SSOStore, jwt *JWTManager, enc *service.Encryption, db *sql.DB, logger *slog.Logger, baseURL string) *SSOHandler {
	return &SSOHandler{
		store:      store,
		jwt:        jwt,
		encryption: enc,
		logger:     logger,
		db:         db,
		baseURL:    baseURL,
	}
}

// HandleSSOLookup handles GET /auth/sso/lookup?email=user@co.com
// It extracts the domain from the email and checks for an enabled SSO config.
func (h *SSOHandler) HandleSSOLookup(w http.ResponseWriter, r *http.Request) {
	email := r.URL.Query().Get("email")
	if email == "" {
		httputil.WriteError(w, http.StatusBadRequest, "MISSING_EMAIL", "email query parameter is required")
		return
	}

	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 || parts[1] == "" {
		httputil.WriteError(w, http.StatusBadRequest, "INVALID_EMAIL", "invalid email format")
		return
	}
	domain := strings.ToLower(parts[1])

	cfg, err := h.store.GetByDomain(r.Context(), domain)
	if err != nil {
		h.logger.Error("sso lookup failed", "error", err, "domain", domain)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_LOOKUP_ERROR", "failed to look up SSO configuration")
		return
	}

	if cfg == nil {
		httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"configured": false,
		})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"configured":    true,
		"provider_type": cfg.ProviderType,
		"org_id":        cfg.OrgID,
		"display_name":  cfg.DisplayName,
	})
}

// HandleSAMLACSEndpoint handles POST /auth/saml/acs
// It parses the SAML response, extracts user info, performs JIT provisioning,
// issues a JWT, and redirects to the dashboard.
func (h *SSOHandler) HandleSAMLACSEndpoint(w http.ResponseWriter, r *http.Request) {
	// The RelayState typically carries the org ID or we need to determine it
	// from the SAML response's issuer. For simplicity, we try to match by
	// looking up all enabled SAML configs and finding the matching one.
	relayState := r.FormValue("RelayState")

	// First, try to parse the SAML response to find the issuer
	// We need the SSO config to build the SP, but we need to parse the response
	// to know which config to use. We use the RelayState to carry the org ID.
	if relayState == "" {
		h.logger.Error("saml acs: missing RelayState (org_id)")
		httputil.WriteError(w, http.StatusBadRequest, "MISSING_RELAY_STATE", "SAML RelayState is required")
		return
	}

	orgID := relayState
	cfg, err := h.store.GetByOrgID(r.Context(), orgID)
	if err != nil {
		h.logger.Error("saml acs: failed to load SSO config", "error", err, "org_id", orgID)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "failed to load SSO configuration")
		return
	}
	if cfg == nil || cfg.ProviderType != "saml" {
		httputil.WriteError(w, http.StatusBadRequest, "SSO_NOT_CONFIGURED", "SAML SSO is not configured for this organization")
		return
	}

	sp, err := NewSAMLServiceProvider(cfg, h.baseURL)
	if err != nil {
		h.logger.Error("saml acs: failed to create SP", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "failed to initialize SAML service provider")
		return
	}

	email, name, err := HandleSAMLACS(sp, r)
	if err != nil {
		h.logger.Error("saml acs: failed to parse response", "error", err)
		httputil.WriteError(w, http.StatusBadRequest, "SAML_ERROR", "failed to process SAML response: "+err.Error())
		return
	}

	// Verify the email domain matches the SSO config
	emailDomain := extractDomain(email)
	if !strings.EqualFold(emailDomain, cfg.EmailDomain) {
		h.logger.Warn("saml acs: email domain mismatch", "email", email, "expected_domain", cfg.EmailDomain)
		httputil.WriteError(w, http.StatusForbidden, "DOMAIN_MISMATCH", "email domain does not match SSO configuration")
		return
	}

	token, err := h.findOrCreateUserAndIssueToken(r.Context(), cfg, email, name)
	if err != nil {
		h.logger.Error("saml acs: user provisioning failed", "error", err, "email", email)
		httputil.WriteError(w, http.StatusInternalServerError, "PROVISIONING_ERROR", "failed to provision user")
		return
	}

	// Redirect to dashboard with token
	redirectURL := fmt.Sprintf("%s/dashboard/overview?token=%s", h.baseURL, token)
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// HandleOIDCLogin handles GET /auth/oidc/{orgID}/login
// It loads the SSO config, builds the OAuth2 config, and redirects to the IdP.
func (h *SSOHandler) HandleOIDCLogin(w http.ResponseWriter, r *http.Request) {
	orgID := chi.URLParam(r, "orgID")
	if orgID == "" {
		httputil.WriteError(w, http.StatusBadRequest, "MISSING_ORG_ID", "organization ID is required")
		return
	}

	cfg, err := h.store.GetByOrgID(r.Context(), orgID)
	if err != nil {
		h.logger.Error("oidc login: failed to load SSO config", "error", err, "org_id", orgID)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "failed to load SSO configuration")
		return
	}
	if cfg == nil || cfg.ProviderType != "oidc" || !cfg.IsEnabled {
		httputil.WriteError(w, http.StatusBadRequest, "SSO_NOT_CONFIGURED", "OIDC SSO is not configured or enabled for this organization")
		return
	}

	// Decrypt the client secret
	clientSecret, err := h.encryption.Decrypt(cfg.OIDCClientSecretEncrypted, cfg.OIDCClientSecretNonce)
	if err != nil {
		h.logger.Error("oidc login: failed to decrypt client secret", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "failed to decrypt OIDC credentials")
		return
	}

	provider, err := NewOIDCProvider(r.Context(), cfg.OIDCIssuerURL)
	if err != nil {
		h.logger.Error("oidc login: OIDC discovery failed", "error", err, "issuer", cfg.OIDCIssuerURL)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "OIDC provider discovery failed")
		return
	}

	redirectURL := h.baseURL + "/auth/oidc/callback"
	oauth2Cfg := BuildOAuth2Config(provider, cfg.OIDCClientID, clientSecret, redirectURL, cfg.OIDCScopes)

	// Generate a random state parameter that encodes the org ID
	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "failed to generate state parameter")
		return
	}
	// State format: orgID:randomHex — allows callback to find the right config
	state := orgID + ":" + hex.EncodeToString(stateBytes)

	authURL := oauth2Cfg.AuthCodeURL(state)
	http.Redirect(w, r, authURL, http.StatusFound)
}

// HandleOIDCCallback handles GET /auth/oidc/callback
// It exchanges the code for tokens, verifies the ID token, performs JIT
// provisioning, issues a JWT, and redirects to the dashboard.
func (h *SSOHandler) HandleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	if code == "" {
		errMsg := r.URL.Query().Get("error_description")
		if errMsg == "" {
			errMsg = r.URL.Query().Get("error")
		}
		if errMsg == "" {
			errMsg = "missing authorization code"
		}
		httputil.WriteError(w, http.StatusBadRequest, "OIDC_ERROR", errMsg)
		return
	}

	// Extract org ID from state (format: orgID:randomHex)
	orgID := ""
	if idx := strings.Index(state, ":"); idx > 0 {
		orgID = state[:idx]
	}
	if orgID == "" {
		httputil.WriteError(w, http.StatusBadRequest, "INVALID_STATE", "invalid state parameter")
		return
	}

	cfg, err := h.store.GetByOrgID(r.Context(), orgID)
	if err != nil {
		h.logger.Error("oidc callback: failed to load SSO config", "error", err, "org_id", orgID)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "failed to load SSO configuration")
		return
	}
	if cfg == nil || cfg.ProviderType != "oidc" {
		httputil.WriteError(w, http.StatusBadRequest, "SSO_NOT_CONFIGURED", "OIDC SSO is not configured for this organization")
		return
	}

	// Decrypt client secret
	clientSecret, err := h.encryption.Decrypt(cfg.OIDCClientSecretEncrypted, cfg.OIDCClientSecretNonce)
	if err != nil {
		h.logger.Error("oidc callback: failed to decrypt client secret", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "failed to decrypt OIDC credentials")
		return
	}

	provider, err := NewOIDCProvider(r.Context(), cfg.OIDCIssuerURL)
	if err != nil {
		h.logger.Error("oidc callback: OIDC discovery failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "OIDC provider discovery failed")
		return
	}

	redirectURL := h.baseURL + "/auth/oidc/callback"
	oauth2Cfg := BuildOAuth2Config(provider, cfg.OIDCClientID, clientSecret, redirectURL, cfg.OIDCScopes)

	email, name, err := ExchangeAndVerify(r.Context(), provider, oauth2Cfg, code)
	if err != nil {
		h.logger.Error("oidc callback: token exchange/verification failed", "error", err)
		httputil.WriteError(w, http.StatusBadRequest, "OIDC_ERROR", "failed to verify identity: "+err.Error())
		return
	}

	// Verify email domain matches
	emailDomain := extractDomain(email)
	if !strings.EqualFold(emailDomain, cfg.EmailDomain) {
		h.logger.Warn("oidc callback: email domain mismatch", "email", email, "expected_domain", cfg.EmailDomain)
		httputil.WriteError(w, http.StatusForbidden, "DOMAIN_MISMATCH", "email domain does not match SSO configuration")
		return
	}

	token, err := h.findOrCreateUserAndIssueToken(r.Context(), cfg, email, name)
	if err != nil {
		h.logger.Error("oidc callback: user provisioning failed", "error", err, "email", email)
		httputil.WriteError(w, http.StatusInternalServerError, "PROVISIONING_ERROR", "failed to provision user")
		return
	}

	// Redirect to dashboard with token
	redirectURL = fmt.Sprintf("%s/dashboard/overview?token=%s", h.baseURL, token)
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// HandleSSOConfigGet handles GET /api/sso
// Returns the org's SSO configuration with the client secret masked.
func (h *SSOHandler) HandleSSOConfigGet(w http.ResponseWriter, r *http.Request) {
	orgID := getOrgIDFromContext(r.Context())
	if orgID == "" {
		httputil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	cfg, err := h.store.GetByOrgID(r.Context(), orgID)
	if err != nil {
		h.logger.Error("sso config get: failed", "error", err, "org_id", orgID)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "failed to load SSO configuration")
		return
	}

	if cfg == nil {
		httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"data":    nil,
			"enabled": false,
		})
		return
	}

	// Mask the client secret for display
	resp := map[string]interface{}{
		"data": map[string]interface{}{
			"id":               cfg.ID,
			"org_id":           cfg.OrgID,
			"provider_type":    cfg.ProviderType,
			"display_name":     cfg.DisplayName,
			"email_domain":     cfg.EmailDomain,
			"default_role":     cfg.DefaultRole,
			"enforce_sso":      cfg.EnforceSSO,
			"is_enabled":       cfg.IsEnabled,
			"idp_entity_id":    cfg.IDPEntityID,
			"idp_sso_url":      cfg.IDPSSOURL,
			"sp_entity_id":     cfg.SPEntityID,
			"sp_acs_url":       cfg.SPACSURL,
			"oidc_issuer_url":  cfg.OIDCIssuerURL,
			"oidc_client_id":   cfg.OIDCClientID,
			"oidc_scopes":      cfg.OIDCScopes,
			"has_metadata_xml": cfg.IDPMetadataXML != "",
			"has_client_secret": cfg.OIDCClientSecretEncrypted != "",
			"created_at":       cfg.CreatedAt,
			"updated_at":       cfg.UpdatedAt,
		},
		"enabled": cfg.IsEnabled,
	}

	httputil.WriteJSON(w, http.StatusOK, resp)
}

// ssoConfigRequest is the JSON body for creating/updating SSO configuration.
type ssoConfigRequest struct {
	ProviderType    string   `json:"provider_type"`
	DisplayName     string   `json:"display_name"`
	EmailDomain     string   `json:"email_domain"`
	DefaultRole     string   `json:"default_role"`
	EnforceSSO      bool     `json:"enforce_sso"`
	IsEnabled       bool     `json:"is_enabled"`
	IDPMetadataXML  string   `json:"idp_metadata_xml"`
	IDPEntityID     string   `json:"idp_entity_id"`
	IDPSSOURL       string   `json:"idp_sso_url"`
	IDPCertificate  string   `json:"idp_certificate"`
	SPEntityID      string   `json:"sp_entity_id"`
	SPACSURL        string   `json:"sp_acs_url"`
	OIDCIssuerURL   string   `json:"oidc_issuer_url"`
	OIDCClientID    string   `json:"oidc_client_id"`
	OIDCClientSecret string  `json:"oidc_client_secret"`
	OIDCScopes      []string `json:"oidc_scopes"`
}

// HandleSSOConfigUpsert handles POST /api/sso
// Validates input, encrypts the OIDC client secret, and upserts the config.
func (h *SSOHandler) HandleSSOConfigUpsert(w http.ResponseWriter, r *http.Request) {
	orgID := getOrgIDFromContext(r.Context())
	if orgID == "" {
		httputil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	var req ssoConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid request body")
		return
	}

	// Validate required fields
	if req.ProviderType != "saml" && req.ProviderType != "oidc" {
		httputil.WriteError(w, http.StatusBadRequest, "INVALID_PROVIDER", "provider_type must be 'saml' or 'oidc'")
		return
	}
	if req.EmailDomain == "" {
		httputil.WriteError(w, http.StatusBadRequest, "MISSING_DOMAIN", "email_domain is required")
		return
	}

	// Validate role
	validRoles := map[string]bool{"owner": true, "admin": true, "member": true, "viewer": true}
	if req.DefaultRole == "" {
		req.DefaultRole = "member"
	}
	if !validRoles[req.DefaultRole] {
		httputil.WriteError(w, http.StatusBadRequest, "INVALID_ROLE", "default_role must be one of: owner, admin, member, viewer")
		return
	}

	// Validate provider-specific fields
	if req.ProviderType == "saml" && req.IDPMetadataXML == "" {
		httputil.WriteError(w, http.StatusBadRequest, "MISSING_METADATA", "idp_metadata_xml is required for SAML providers")
		return
	}
	if req.ProviderType == "oidc" {
		if req.OIDCIssuerURL == "" {
			httputil.WriteError(w, http.StatusBadRequest, "MISSING_ISSUER", "oidc_issuer_url is required for OIDC providers")
			return
		}
		if req.OIDCClientID == "" {
			httputil.WriteError(w, http.StatusBadRequest, "MISSING_CLIENT_ID", "oidc_client_id is required for OIDC providers")
			return
		}
	}

	cfg := &SSOConfig{
		OrgID:          orgID,
		ProviderType:   req.ProviderType,
		DisplayName:    req.DisplayName,
		EmailDomain:    strings.ToLower(req.EmailDomain),
		DefaultRole:    req.DefaultRole,
		EnforceSSO:     req.EnforceSSO,
		IsEnabled:      req.IsEnabled,
		IDPMetadataXML: req.IDPMetadataXML,
		IDPEntityID:    req.IDPEntityID,
		IDPSSOURL:      req.IDPSSOURL,
		IDPCertificate: req.IDPCertificate,
		SPEntityID:     req.SPEntityID,
		SPACSURL:       req.SPACSURL,
		OIDCIssuerURL:  req.OIDCIssuerURL,
		OIDCClientID:   req.OIDCClientID,
		OIDCScopes:     req.OIDCScopes,
	}

	// Set default scopes for OIDC if none provided
	if cfg.ProviderType == "oidc" && len(cfg.OIDCScopes) == 0 {
		cfg.OIDCScopes = []string{"openid", "profile", "email"}
	}

	// Encrypt OIDC client secret if provided
	if req.OIDCClientSecret != "" {
		ciphertext, nonce, err := h.encryption.Encrypt(req.OIDCClientSecret)
		if err != nil {
			h.logger.Error("sso config upsert: encryption failed", "error", err)
			httputil.WriteError(w, http.StatusInternalServerError, "ENCRYPTION_ERROR", "failed to encrypt client secret")
			return
		}
		cfg.OIDCClientSecretEncrypted = ciphertext
		cfg.OIDCClientSecretNonce = nonce
	} else if cfg.ProviderType == "oidc" {
		// If no new secret provided for OIDC, keep the existing one
		existing, err := h.store.GetByOrgID(r.Context(), orgID)
		if err == nil && existing != nil {
			cfg.OIDCClientSecretEncrypted = existing.OIDCClientSecretEncrypted
			cfg.OIDCClientSecretNonce = existing.OIDCClientSecretNonce
		}
	}

	// Generate SP Entity ID and ACS URL defaults for SAML
	if cfg.ProviderType == "saml" {
		if cfg.SPEntityID == "" {
			cfg.SPEntityID = h.baseURL + "/auth/saml/metadata"
		}
		if cfg.SPACSURL == "" {
			cfg.SPACSURL = h.baseURL + "/auth/saml/acs"
		}
	}

	if err := h.store.Upsert(r.Context(), cfg); err != nil {
		h.logger.Error("sso config upsert: failed", "error", err, "org_id", orgID)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "failed to save SSO configuration")
		return
	}

	h.logger.Info("sso config saved", "org_id", orgID, "provider", cfg.ProviderType, "domain", cfg.EmailDomain)
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"message": "SSO configuration saved",
	})
}

// HandleSSOConfigDelete handles DELETE /api/sso
// Deletes the org's SSO configuration.
func (h *SSOHandler) HandleSSOConfigDelete(w http.ResponseWriter, r *http.Request) {
	orgID := getOrgIDFromContext(r.Context())
	if orgID == "" {
		httputil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing organization context")
		return
	}

	if err := h.store.Delete(r.Context(), orgID); err != nil {
		h.logger.Error("sso config delete: failed", "error", err, "org_id", orgID)
		httputil.WriteError(w, http.StatusInternalServerError, "SSO_ERROR", "failed to delete SSO configuration")
		return
	}

	h.logger.Info("sso config deleted", "org_id", orgID)
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"message": "SSO configuration deleted",
	})
}

// findOrCreateUserAndIssueToken looks up a user by email within the org.
// If not found, it creates the user with the SSO config's default role (JIT provisioning).
// It then issues a JWT token.
func (h *SSOHandler) findOrCreateUserAndIssueToken(ctx context.Context, cfg *SSOConfig, email, name string) (string, error) {
	var userID, role string

	// Look up user by email in the org
	err := h.db.QueryRowContext(ctx,
		`SELECT id, role FROM users WHERE email = $1 AND org_id = $2`,
		email, cfg.OrgID,
	).Scan(&userID, &role)

	if err == sql.ErrNoRows {
		// JIT provisioning: create the user with the SSO config's default role
		jitRole := cfg.DefaultRole
		if jitRole == "viewer" {
			// The users table check constraint may not include 'viewer',
			// fall back to 'member' in that case.
			jitRole = "member"
		}
		if name == "" {
			name = strings.Split(email, "@")[0]
		}
		err = h.db.QueryRowContext(ctx,
			`INSERT INTO users (email, name, org_id, role)
			 VALUES ($1, $2, $3, $4)
			 RETURNING id`,
			email, name, cfg.OrgID, jitRole,
		).Scan(&userID)
		if err != nil {
			return "", fmt.Errorf("create SSO user: %w", err)
		}
		role = jitRole
		h.logger.Info("sso jit provisioning: created user", "email", email, "org_id", cfg.OrgID, "role", role)
	} else if err != nil {
		return "", fmt.Errorf("look up user: %w", err)
	} else {
		// Existing user — optionally update name if it was empty
		if name != "" {
			_, _ = h.db.ExecContext(ctx,
				`UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 AND name = ''`,
				name, userID,
			)
		}
	}

	token, err := h.jwt.GenerateToken(userID, cfg.OrgID, email, role)
	if err != nil {
		return "", fmt.Errorf("generate JWT: %w", err)
	}

	return token, nil
}

// extractDomain extracts the domain part from an email address.
func extractDomain(email string) string {
	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 {
		return ""
	}
	return strings.ToLower(parts[1])
}

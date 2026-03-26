package auth

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/lib/pq"
)

// SSOConfig represents a row in the sso_configs table.
type SSOConfig struct {
	ID                       string    `json:"id"`
	OrgID                    string    `json:"org_id"`
	ProviderType             string    `json:"provider_type"` // "saml" or "oidc"
	DisplayName              string    `json:"display_name"`
	IDPMetadataXML           string    `json:"idp_metadata_xml,omitempty"`
	IDPEntityID              string    `json:"idp_entity_id,omitempty"`
	IDPSSOURL                string    `json:"idp_sso_url,omitempty"`
	IDPCertificate           string    `json:"idp_certificate,omitempty"`
	SPEntityID               string    `json:"sp_entity_id,omitempty"`
	SPACSURL                 string    `json:"sp_acs_url,omitempty"`
	OIDCIssuerURL            string    `json:"oidc_issuer_url,omitempty"`
	OIDCClientID             string    `json:"oidc_client_id,omitempty"`
	OIDCClientSecretEncrypted string   `json:"oidc_client_secret_encrypted,omitempty"`
	OIDCClientSecretNonce    string    `json:"oidc_client_secret_nonce,omitempty"`
	OIDCScopes               []string  `json:"oidc_scopes,omitempty"`
	EmailDomain              string    `json:"email_domain"`
	DefaultRole              string    `json:"default_role"`
	EnforceSSO               bool      `json:"enforce_sso"`
	IsEnabled                bool      `json:"is_enabled"`
	CreatedAt                time.Time `json:"created_at"`
	UpdatedAt                time.Time `json:"updated_at"`
}

// SSOStore provides CRUD operations for the sso_configs table.
type SSOStore struct {
	db *sql.DB
}

// NewSSOStore creates a new SSO config store.
func NewSSOStore(db *sql.DB) *SSOStore {
	return &SSOStore{db: db}
}

// GetByDomain looks up an enabled SSO config by email domain.
func (s *SSOStore) GetByDomain(ctx context.Context, domain string) (*SSOConfig, error) {
	cfg := &SSOConfig{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, org_id, provider_type, display_name,
			COALESCE(idp_metadata_xml, ''), COALESCE(idp_entity_id, ''),
			COALESCE(idp_sso_url, ''), COALESCE(idp_certificate, ''),
			COALESCE(sp_entity_id, ''), COALESCE(sp_acs_url, ''),
			COALESCE(oidc_issuer_url, ''), COALESCE(oidc_client_id, ''),
			COALESCE(oidc_client_secret_encrypted, ''), COALESCE(oidc_client_secret_nonce, ''),
			COALESCE(oidc_scopes, '{openid,profile,email}'),
			email_domain, default_role, enforce_sso, is_enabled,
			created_at, updated_at
		FROM sso_configs
		WHERE email_domain = $1 AND is_enabled = true
		LIMIT 1
	`, domain).Scan(
		&cfg.ID, &cfg.OrgID, &cfg.ProviderType, &cfg.DisplayName,
		&cfg.IDPMetadataXML, &cfg.IDPEntityID,
		&cfg.IDPSSOURL, &cfg.IDPCertificate,
		&cfg.SPEntityID, &cfg.SPACSURL,
		&cfg.OIDCIssuerURL, &cfg.OIDCClientID,
		&cfg.OIDCClientSecretEncrypted, &cfg.OIDCClientSecretNonce,
		pq.Array(&cfg.OIDCScopes),
		&cfg.EmailDomain, &cfg.DefaultRole, &cfg.EnforceSSO, &cfg.IsEnabled,
		&cfg.CreatedAt, &cfg.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get SSO config by domain: %w", err)
	}
	return cfg, nil
}

// GetByOrgID gets an org's SSO config (enabled or disabled).
func (s *SSOStore) GetByOrgID(ctx context.Context, orgID string) (*SSOConfig, error) {
	cfg := &SSOConfig{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, org_id, provider_type, display_name,
			COALESCE(idp_metadata_xml, ''), COALESCE(idp_entity_id, ''),
			COALESCE(idp_sso_url, ''), COALESCE(idp_certificate, ''),
			COALESCE(sp_entity_id, ''), COALESCE(sp_acs_url, ''),
			COALESCE(oidc_issuer_url, ''), COALESCE(oidc_client_id, ''),
			COALESCE(oidc_client_secret_encrypted, ''), COALESCE(oidc_client_secret_nonce, ''),
			COALESCE(oidc_scopes, '{openid,profile,email}'),
			email_domain, default_role, enforce_sso, is_enabled,
			created_at, updated_at
		FROM sso_configs
		WHERE org_id = $1
		LIMIT 1
	`, orgID).Scan(
		&cfg.ID, &cfg.OrgID, &cfg.ProviderType, &cfg.DisplayName,
		&cfg.IDPMetadataXML, &cfg.IDPEntityID,
		&cfg.IDPSSOURL, &cfg.IDPCertificate,
		&cfg.SPEntityID, &cfg.SPACSURL,
		&cfg.OIDCIssuerURL, &cfg.OIDCClientID,
		&cfg.OIDCClientSecretEncrypted, &cfg.OIDCClientSecretNonce,
		pq.Array(&cfg.OIDCScopes),
		&cfg.EmailDomain, &cfg.DefaultRole, &cfg.EnforceSSO, &cfg.IsEnabled,
		&cfg.CreatedAt, &cfg.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get SSO config by org: %w", err)
	}
	return cfg, nil
}

// Upsert inserts or updates an SSO config (ON CONFLICT on org_id + email_domain).
func (s *SSOStore) Upsert(ctx context.Context, cfg *SSOConfig) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO sso_configs (
			org_id, provider_type, display_name,
			idp_metadata_xml, idp_entity_id, idp_sso_url, idp_certificate,
			sp_entity_id, sp_acs_url,
			oidc_issuer_url, oidc_client_id, oidc_client_secret_encrypted, oidc_client_secret_nonce,
			oidc_scopes, email_domain, default_role, enforce_sso, is_enabled,
			updated_at
		) VALUES (
			$1, $2, $3,
			$4, $5, $6, $7,
			$8, $9,
			$10, $11, $12, $13,
			$14, $15, $16, $17, $18,
			NOW()
		)
		ON CONFLICT (org_id, email_domain) DO UPDATE SET
			provider_type = EXCLUDED.provider_type,
			display_name = EXCLUDED.display_name,
			idp_metadata_xml = EXCLUDED.idp_metadata_xml,
			idp_entity_id = EXCLUDED.idp_entity_id,
			idp_sso_url = EXCLUDED.idp_sso_url,
			idp_certificate = EXCLUDED.idp_certificate,
			sp_entity_id = EXCLUDED.sp_entity_id,
			sp_acs_url = EXCLUDED.sp_acs_url,
			oidc_issuer_url = EXCLUDED.oidc_issuer_url,
			oidc_client_id = EXCLUDED.oidc_client_id,
			oidc_client_secret_encrypted = EXCLUDED.oidc_client_secret_encrypted,
			oidc_client_secret_nonce = EXCLUDED.oidc_client_secret_nonce,
			oidc_scopes = EXCLUDED.oidc_scopes,
			default_role = EXCLUDED.default_role,
			enforce_sso = EXCLUDED.enforce_sso,
			is_enabled = EXCLUDED.is_enabled,
			updated_at = NOW()
	`,
		cfg.OrgID, cfg.ProviderType, cfg.DisplayName,
		nullIfEmpty(cfg.IDPMetadataXML), nullIfEmpty(cfg.IDPEntityID),
		nullIfEmpty(cfg.IDPSSOURL), nullIfEmpty(cfg.IDPCertificate),
		nullIfEmpty(cfg.SPEntityID), nullIfEmpty(cfg.SPACSURL),
		nullIfEmpty(cfg.OIDCIssuerURL), nullIfEmpty(cfg.OIDCClientID),
		nullIfEmpty(cfg.OIDCClientSecretEncrypted), nullIfEmpty(cfg.OIDCClientSecretNonce),
		pq.Array(cfg.OIDCScopes), cfg.EmailDomain, cfg.DefaultRole,
		cfg.EnforceSSO, cfg.IsEnabled,
	)
	if err != nil {
		return fmt.Errorf("upsert SSO config: %w", err)
	}
	return nil
}

// Delete removes an org's SSO config.
func (s *SSOStore) Delete(ctx context.Context, orgID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sso_configs WHERE org_id = $1`, orgID)
	if err != nil {
		return fmt.Errorf("delete SSO config: %w", err)
	}
	return nil
}

// nullIfEmpty returns a sql.NullString that is NULL when the input is empty.
func nullIfEmpty(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

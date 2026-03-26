# Enterprise Auth, RBAC & Audit Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SAML/OIDC SSO, role enforcement (owner/admin/viewer), and audit logging to AgentStack for enterprise security compliance.

**Architecture:** Three layers built bottom-up: (1) database migrations for SSO configs, roles, and audit logs, (2) Go middleware + services for RBAC and audit, (3) SSO auth flows with SAML/OIDC libraries, (4) frontend pages for SSO config, audit log viewer, and role-based UI.

**Tech Stack:** Go (crewjam/saml, coreos/go-oidc), PostgreSQL, Next.js 14, Tailwind, Framer Motion

**Spec:** `docs/superpowers/specs/2026-03-27-enterprise-auth-rbac-audit.md`

---

## Task 1: Database Migrations (SSO, RBAC, Audit)

**Files:**
- Create: `migrations/postgres/012_sso_config.up.sql`
- Create: `migrations/postgres/012_sso_config.down.sql`
- Create: `migrations/postgres/013_rbac.up.sql`
- Create: `migrations/postgres/013_rbac.down.sql`
- Create: `migrations/postgres/014_audit_logs.up.sql`
- Create: `migrations/postgres/014_audit_logs.down.sql`

- [ ] **Step 1: Create SSO config migration**

```sql
-- 012_sso_config.up.sql
CREATE TABLE IF NOT EXISTS sso_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('saml', 'oidc')),
    display_name TEXT NOT NULL DEFAULT '',
    idp_metadata_xml TEXT,
    idp_entity_id TEXT,
    idp_sso_url TEXT,
    idp_certificate TEXT,
    sp_entity_id TEXT,
    sp_acs_url TEXT,
    oidc_issuer_url TEXT,
    oidc_client_id TEXT,
    oidc_client_secret_encrypted TEXT,
    oidc_client_secret_nonce TEXT,
    oidc_scopes TEXT[] DEFAULT '{openid,profile,email}',
    email_domain TEXT NOT NULL,
    default_role TEXT NOT NULL DEFAULT 'viewer',
    enforce_sso BOOLEAN NOT NULL DEFAULT false,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, email_domain)
);
CREATE INDEX idx_sso_configs_domain ON sso_configs(email_domain) WHERE is_enabled = true;
```

```sql
-- 012_sso_config.down.sql
DROP TABLE IF EXISTS sso_configs;
```

- [ ] **Step 2: Create RBAC migration**

```sql
-- 013_rbac.up.sql
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permissions TEXT[] NOT NULL DEFAULT '{}',
    is_system BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, name)
);
```

```sql
-- 013_rbac.down.sql
DROP TABLE IF EXISTS roles;
```

- [ ] **Step 3: Create audit logs migration**

```sql
-- 014_audit_logs.up.sql
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    user_email TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL DEFAULT '',
    details JSONB DEFAULT '{}',
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_org_time ON audit_logs(org_id, created_at DESC);
CREATE INDEX idx_audit_logs_user ON audit_logs(org_id, user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(org_id, resource_type, resource_id);
```

```sql
-- 014_audit_logs.down.sql
DROP TABLE IF EXISTS audit_logs;
```

- [ ] **Step 4: Run migrations**

```bash
cd /Users/harishtalluri/dev_fr/agentstack-fresh
set -a && source .env && set +a && go run ./cmd/migrate/main.go
```

Verify tables exist:
```bash
PGPASSWORD=agentstack_dev psql -h localhost -p 5436 -U agentstack -d agentstack -c "\dt sso_configs" -c "\dt roles" -c "\dt audit_logs"
```

- [ ] **Step 5: Commit**

```bash
git add migrations/postgres/012* migrations/postgres/013* migrations/postgres/014*
git commit -m "feat: add database migrations for SSO configs, RBAC roles, and audit logs"
```

---

## Task 2: RBAC Middleware

**Files:**
- Create: `internal/server/middleware/rbac.go`
- Modify: `internal/server/middleware/auth.go` (add GetUserEmail, GetClientIP helpers)

- [ ] **Step 1: Add context helpers to auth.go**

Add after existing GetUserID (line ~117) in `internal/server/middleware/auth.go`:

```go
const UserEmailKey = "user_email"
const ClientIPKey = "client_ip"

func GetUserEmail(ctx context.Context) string {
    if v, ok := ctx.Value(UserEmailKey).(string); ok {
        return v
    }
    return ""
}

func GetClientIP(r *http.Request) string {
    if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
        return strings.Split(ip, ",")[0]
    }
    if ip := r.Header.Get("X-Real-IP"); ip != "" {
        return ip
    }
    host, _, _ := net.SplitHostPort(r.RemoteAddr)
    return host
}
```

Also update `DualAuth` and `JWTAuth` to set `UserEmailKey` in context from JWT claims:

```go
// In JWTAuth, after validating token:
ctx = context.WithValue(ctx, UserEmailKey, claims.Email)
```

- [ ] **Step 2: Create RBAC middleware**

```go
// internal/server/middleware/rbac.go
package middleware

import (
    "net/http"
)

// roleHierarchy maps roles to their numeric level (higher = more permissions)
var roleHierarchy = map[string]int{
    "viewer": 1,
    "member": 1,  // alias for viewer (backward compat)
    "admin":  2,
    "owner":  3,
}

// RequireRole returns middleware that enforces a minimum role level.
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

func getUserRole(ctx context.Context) string {
    // Role is set in JWT claims by JWTAuth/DualAuth middleware
    if v, ok := ctx.Value("user_role").(string); ok {
        return v
    }
    // API key requests default to admin (backward compat)
    if v, ok := ctx.Value(APIKeyIDKey).(string); ok && v != "" {
        return "admin"
    }
    return ""
}
```

Also update JWTAuth in auth.go to set the role in context:

```go
// In JWTAuth, after validating token:
ctx = context.WithValue(ctx, "user_role", claims.Role)
```

- [ ] **Step 3: Test compilation**

```bash
go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add internal/server/middleware/rbac.go internal/server/middleware/auth.go
git commit -m "feat: add RBAC middleware with role hierarchy (owner > admin > viewer)"
```

---

## Task 3: Apply RBAC to Routes

**Files:**
- Modify: `internal/server/routes.go` (lines 463-488 for /api, various /v1 sub-routes)

- [ ] **Step 1: Protect /api routes with role requirements**

In `routes.go`, the `/api` group (line 463) currently uses `JWTAuth` only. Add role restrictions:

```go
s.router.Route("/api", func(r chi.Router) {
    r.Use(middleware.JWTAuth(s.jwtManager))

    // Owner-only: org management, SSO config
    r.Route("/org", func(r chi.Router) {
        r.Use(middleware.RequireRole("owner"))
        r.Get("/", s.handleGetOrg)
        r.Patch("/", s.handleUpdateOrg)
        r.Delete("/", s.handleDeleteOrg)
    })

    // Admin+: API key management
    r.Route("/api-keys", func(r chi.Router) {
        r.Get("/", s.handleListAPIKeys)  // All roles can view
        r.With(middleware.RequireRole("admin")).Post("/", s.handleCreateAPIKey)
        r.With(middleware.RequireRole("admin")).Delete("/{id}", s.handleDeleteAPIKey)
    })

    // Admin+: team management
    r.Route("/team", func(r chi.Router) {
        r.Get("/", s.handleListTeam)  // All roles can view
        r.With(middleware.RequireRole("owner")).Post("/invite", s.handleInviteTeamMember)
        r.With(middleware.RequireRole("owner")).Patch("/{id}/role", s.handleUpdateTeamMemberRole)
        r.With(middleware.RequireRole("owner")).Delete("/{id}", s.handleRemoveTeamMember)
    })
})
```

- [ ] **Step 2: Protect /v1 mutation routes**

For guard rules, alert rules, test suites, providers, routes, webhooks, prompts, datasets — wrap POST/PUT/DELETE with `RequireRole("admin")`:

Pattern to apply to each CRUD group:
```go
r.Route("/guard/rules", func(r chi.Router) {
    r.Get("/", rulesHandler.List)           // All roles
    r.Get("/{id}", rulesHandler.Get)        // All roles
    r.With(middleware.RequireRole("admin")).Post("/", rulesHandler.Create)
    r.With(middleware.RequireRole("admin")).Put("/{id}", rulesHandler.Update)
    r.With(middleware.RequireRole("admin")).Delete("/{id}", rulesHandler.Delete)
})
```

Apply this pattern to: guard/rules, alerts, test/suites, test/cases, test/evaluators, gateway/providers, gateway/routes, gateway/fallbacks, cost/budgets, prompts, datasets, webhooks, settings/sampling.

- [ ] **Step 3: Test RBAC enforcement**

```bash
# Test that viewer gets 403 on mutation
# First, create a viewer JWT (or modify test to use viewer role)
go build ./...
set -a && source .env && set +a && go test ./... -count=1
```

- [ ] **Step 4: Commit**

```bash
git add internal/server/routes.go
git commit -m "feat: apply RBAC role enforcement to all API and v1 mutation routes"
```

---

## Task 4: Audit Logging Service

**Files:**
- Create: `internal/audit/service.go`
- Create: `internal/audit/store.go`
- Create: `internal/audit/handler.go`

- [ ] **Step 1: Create audit store**

```go
// internal/audit/store.go
package audit

import (
    "context"
    "database/sql"
    "encoding/json"
    "fmt"
    "time"
    "github.com/lib/pq"
)

type Entry struct {
    ID           string          `json:"id"`
    OrgID        string          `json:"org_id"`
    UserID       string          `json:"user_id"`
    UserEmail    string          `json:"user_email"`
    Action       string          `json:"action"`
    ResourceType string          `json:"resource_type"`
    ResourceID   string          `json:"resource_id"`
    Details      json.RawMessage `json:"details"`
    IPAddress    string          `json:"ip_address"`
    UserAgent    string          `json:"user_agent"`
    CreatedAt    time.Time       `json:"created_at"`
}

type Store struct {
    db *sql.DB
}

func NewStore(db *sql.DB) *Store {
    return &Store{db: db}
}

func (s *Store) Insert(ctx context.Context, e *Entry) error {
    _, err := s.db.ExecContext(ctx,
        `INSERT INTO audit_logs (org_id, user_id, user_email, action, resource_type, resource_id, details, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        e.OrgID, e.UserID, e.UserEmail, e.Action, e.ResourceType, e.ResourceID, e.Details, e.IPAddress, e.UserAgent)
    return err
}

func (s *Store) List(ctx context.Context, orgID string, page, perPage int, filters map[string]string) ([]Entry, int, error) {
    // Build query with optional filters: user_id, action, resource_type, start, end
    where := "WHERE org_id = $1"
    args := []interface{}{orgID}
    argIdx := 2

    if uid := filters["user_id"]; uid != "" {
        where += fmt.Sprintf(" AND user_id = $%d", argIdx)
        args = append(args, uid)
        argIdx++
    }
    if action := filters["action"]; action != "" {
        where += fmt.Sprintf(" AND action = $%d", argIdx)
        args = append(args, action)
        argIdx++
    }
    if rt := filters["resource_type"]; rt != "" {
        where += fmt.Sprintf(" AND resource_type = $%d", argIdx)
        args = append(args, rt)
        argIdx++
    }

    // Count
    var total int
    countQ := "SELECT count(*) FROM audit_logs " + where
    s.db.QueryRowContext(ctx, countQ, args...).Scan(&total)

    // Query
    query := fmt.Sprintf("SELECT id, org_id, user_id, user_email, action, resource_type, resource_id, details, ip_address, user_agent, created_at FROM audit_logs %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d", where, argIdx, argIdx+1)
    args = append(args, perPage, (page-1)*perPage)

    rows, err := s.db.QueryContext(ctx, query, args...)
    if err != nil {
        return nil, 0, err
    }
    defer rows.Close()

    var entries []Entry
    for rows.Next() {
        var e Entry
        if err := rows.Scan(&e.ID, &e.OrgID, &e.UserID, &e.UserEmail, &e.Action, &e.ResourceType, &e.ResourceID, &e.Details, &e.IPAddress, &e.UserAgent, &e.CreatedAt); err != nil {
            return nil, 0, err
        }
        entries = append(entries, e)
    }
    if entries == nil {
        entries = []Entry{}
    }
    return entries, total, nil
}
```

- [ ] **Step 2: Create audit service**

```go
// internal/audit/service.go
package audit

import (
    "context"
    "encoding/json"
    "log/slog"
    "net/http"

    "github.com/agentstack/agentstack/internal/server/middleware"
)

type Logger struct {
    store  *Store
    logger *slog.Logger
}

func NewLogger(store *Store, logger *slog.Logger) *Logger {
    return &Logger{store: store, logger: logger}
}

// Log records an audit event asynchronously (non-blocking).
func (a *Logger) Log(r *http.Request, action, resourceType, resourceID string, details map[string]interface{}) {
    ctx := r.Context()
    orgID := middleware.GetOrgID(ctx)
    userID := middleware.GetUserID(ctx)
    email := middleware.GetUserEmail(ctx)
    ip := middleware.GetClientIP(r)

    detailsJSON, _ := json.Marshal(details)

    // Fire and forget — audit logging must never block the request
    go func() {
        if err := a.store.Insert(context.Background(), &Entry{
            OrgID:        orgID,
            UserID:       userID,
            UserEmail:    email,
            Action:       action,
            ResourceType: resourceType,
            ResourceID:   resourceID,
            Details:      detailsJSON,
            IPAddress:    ip,
            UserAgent:    r.UserAgent(),
        }); err != nil {
            a.logger.Error("failed to write audit log", "error", err, "action", action)
        }
    }()
}
```

- [ ] **Step 3: Create audit handler**

```go
// internal/audit/handler.go
package audit

import (
    "net/http"
    "strconv"

    "github.com/agentstack/agentstack/internal/server/httputil"
    "github.com/agentstack/agentstack/internal/server/middleware"
)

type Handler struct {
    store *Store
}

func NewHandler(store *Store) *Handler {
    return &Handler{store: store}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
    orgID := middleware.GetOrgID(r.Context())
    q := r.URL.Query()

    page, _ := strconv.Atoi(q.Get("page"))
    if page < 1 { page = 1 }
    perPage, _ := strconv.Atoi(q.Get("per_page"))
    if perPage < 1 || perPage > 100 { perPage = 50 }

    filters := map[string]string{
        "user_id":       q.Get("user_id"),
        "action":        q.Get("action"),
        "resource_type": q.Get("resource_type"),
    }

    entries, total, err := h.store.List(r.Context(), orgID, page, perPage, filters)
    if err != nil {
        httputil.WriteError(w, http.StatusInternalServerError, "QUERY_ERROR", "failed to list audit logs")
        return
    }

    httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
        "data": entries,
        "meta": map[string]interface{}{
            "page":        page,
            "per_page":    perPage,
            "total":       total,
            "total_pages": (total + perPage - 1) / perPage,
        },
    })
}
```

- [ ] **Step 4: Wire audit service into server and register routes**

In `internal/server/server.go` or wherever the server struct is initialized, add `auditLogger *audit.Logger` field. Create it during server setup.

In `routes.go`, add the audit log endpoint in the `/api` group:

```go
r.Route("/audit-logs", func(r chi.Router) {
    r.Use(middleware.RequireRole("admin"))
    r.Get("/", auditHandler.List)
})
```

- [ ] **Step 5: Add audit.Log calls to existing mutation handlers**

Add `audit.Log(r, action, resourceType, resourceID, details)` after successful mutations in:

- `handle_apikeys.go` — Create/Delete API keys
- `handle_team.go` — Invite/Remove/Update role
- Guard rules handler — Create/Update/Delete
- Alert rules handler — Create/Update/Delete
- Test suites handler — Create/Delete
- Provider handler — Create/Update/Delete
- Route rules handler — Create/Update/Delete
- Webhook handler — Create/Update/Delete
- Prompts handler — Create/Update/Delete/Deploy
- Budget handler — Create/Update/Delete

Each call follows this pattern:
```go
s.audit.Log(r, "created", "api_key", keyID, map[string]interface{}{
    "name": req.Name,
})
```

- [ ] **Step 6: Test compilation + existing tests**

```bash
go build ./...
set -a && source .env && set +a && go test ./... -count=1
```

- [ ] **Step 7: Commit**

```bash
git add internal/audit/ internal/server/
git commit -m "feat: audit logging service with async recording and query API"
```

---

## Task 5: SSO — Install Dependencies + SSO Config Store

**Files:**
- Create: `internal/auth/sso_store.go`

- [ ] **Step 1: Install SAML and OIDC libraries**

```bash
cd /Users/harishtalluri/dev_fr/agentstack-fresh
go get github.com/crewjam/saml
go get github.com/coreos/go-oidc/v3
go get golang.org/x/oauth2
```

- [ ] **Step 2: Create SSO config store**

```go
// internal/auth/sso_store.go
package auth

import (
    "context"
    "database/sql"
    "time"

    "github.com/lib/pq"
)

type SSOConfig struct {
    ID                      string    `json:"id"`
    OrgID                   string    `json:"org_id"`
    ProviderType            string    `json:"provider_type"` // "saml" or "oidc"
    DisplayName             string    `json:"display_name"`
    IDPMetadataXML          string    `json:"idp_metadata_xml,omitempty"`
    IDPEntityID             string    `json:"idp_entity_id,omitempty"`
    IDPSSOURL               string    `json:"idp_sso_url,omitempty"`
    IDPCertificate          string    `json:"idp_certificate,omitempty"`
    SPEntityID              string    `json:"sp_entity_id,omitempty"`
    SPACSURL                string    `json:"sp_acs_url,omitempty"`
    OIDCIssuerURL           string    `json:"oidc_issuer_url,omitempty"`
    OIDCClientID            string    `json:"oidc_client_id,omitempty"`
    OIDCClientSecretEnc     string    `json:"-"`
    OIDCClientSecretNonce   string    `json:"-"`
    OIDCScopes              []string  `json:"oidc_scopes"`
    EmailDomain             string    `json:"email_domain"`
    DefaultRole             string    `json:"default_role"`
    EnforceSSO              bool      `json:"enforce_sso"`
    IsEnabled               bool      `json:"is_enabled"`
    CreatedAt               time.Time `json:"created_at"`
    UpdatedAt               time.Time `json:"updated_at"`
}

type SSOStore struct {
    db *sql.DB
}

func NewSSOStore(db *sql.DB) *SSOStore {
    return &SSOStore{db: db}
}

func (s *SSOStore) GetByDomain(ctx context.Context, domain string) (*SSOConfig, error) {
    // Look up enabled SSO config by email domain
    var cfg SSOConfig
    err := s.db.QueryRowContext(ctx,
        `SELECT id, org_id, provider_type, display_name, idp_metadata_xml, idp_entity_id, idp_sso_url, idp_certificate,
                sp_entity_id, sp_acs_url, oidc_issuer_url, oidc_client_id, oidc_client_secret_encrypted, oidc_client_secret_nonce,
                oidc_scopes, email_domain, default_role, enforce_sso, is_enabled, created_at, updated_at
         FROM sso_configs WHERE email_domain = $1 AND is_enabled = true`, domain).Scan(
        &cfg.ID, &cfg.OrgID, &cfg.ProviderType, &cfg.DisplayName,
        &cfg.IDPMetadataXML, &cfg.IDPEntityID, &cfg.IDPSSOURL, &cfg.IDPCertificate,
        &cfg.SPEntityID, &cfg.SPACSURL,
        &cfg.OIDCIssuerURL, &cfg.OIDCClientID, &cfg.OIDCClientSecretEnc, &cfg.OIDCClientSecretNonce,
        pq.Array(&cfg.OIDCScopes), &cfg.EmailDomain, &cfg.DefaultRole, &cfg.EnforceSSO, &cfg.IsEnabled,
        &cfg.CreatedAt, &cfg.UpdatedAt)
    if err == sql.ErrNoRows {
        return nil, nil
    }
    return &cfg, err
}

func (s *SSOStore) GetByOrgID(ctx context.Context, orgID string) (*SSOConfig, error) {
    // Same query but filtered by org_id
    var cfg SSOConfig
    err := s.db.QueryRowContext(ctx,
        `SELECT id, org_id, provider_type, display_name, idp_metadata_xml, idp_entity_id, idp_sso_url, idp_certificate,
                sp_entity_id, sp_acs_url, oidc_issuer_url, oidc_client_id, oidc_client_secret_encrypted, oidc_client_secret_nonce,
                oidc_scopes, email_domain, default_role, enforce_sso, is_enabled, created_at, updated_at
         FROM sso_configs WHERE org_id = $1`, orgID).Scan(
        &cfg.ID, &cfg.OrgID, &cfg.ProviderType, &cfg.DisplayName,
        &cfg.IDPMetadataXML, &cfg.IDPEntityID, &cfg.IDPSSOURL, &cfg.IDPCertificate,
        &cfg.SPEntityID, &cfg.SPACSURL,
        &cfg.OIDCIssuerURL, &cfg.OIDCClientID, &cfg.OIDCClientSecretEnc, &cfg.OIDCClientSecretNonce,
        pq.Array(&cfg.OIDCScopes), &cfg.EmailDomain, &cfg.DefaultRole, &cfg.EnforceSSO, &cfg.IsEnabled,
        &cfg.CreatedAt, &cfg.UpdatedAt)
    if err == sql.ErrNoRows {
        return nil, nil
    }
    return &cfg, err
}

func (s *SSOStore) Upsert(ctx context.Context, cfg *SSOConfig) error {
    _, err := s.db.ExecContext(ctx,
        `INSERT INTO sso_configs (org_id, provider_type, display_name, idp_metadata_xml, idp_entity_id, idp_sso_url, idp_certificate,
            sp_entity_id, sp_acs_url, oidc_issuer_url, oidc_client_id, oidc_client_secret_encrypted, oidc_client_secret_nonce,
            oidc_scopes, email_domain, default_role, enforce_sso, is_enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (org_id, email_domain) DO UPDATE SET
            provider_type=$2, display_name=$3, idp_metadata_xml=$4, idp_entity_id=$5, idp_sso_url=$6, idp_certificate=$7,
            sp_entity_id=$8, sp_acs_url=$9, oidc_issuer_url=$10, oidc_client_id=$11, oidc_client_secret_encrypted=$12,
            oidc_client_secret_nonce=$13, oidc_scopes=$14, email_domain=$15, default_role=$16, enforce_sso=$17, is_enabled=$18,
            updated_at=now()`,
        cfg.OrgID, cfg.ProviderType, cfg.DisplayName,
        cfg.IDPMetadataXML, cfg.IDPEntityID, cfg.IDPSSOURL, cfg.IDPCertificate,
        cfg.SPEntityID, cfg.SPACSURL,
        cfg.OIDCIssuerURL, cfg.OIDCClientID, cfg.OIDCClientSecretEnc, cfg.OIDCClientSecretNonce,
        pq.Array(cfg.OIDCScopes), cfg.EmailDomain, cfg.DefaultRole, cfg.EnforceSSO, cfg.IsEnabled)
    return err
}

func (s *SSOStore) Delete(ctx context.Context, orgID string) error {
    _, err := s.db.ExecContext(ctx, "DELETE FROM sso_configs WHERE org_id = $1", orgID)
    return err
}
```

- [ ] **Step 3: Test compilation**

```bash
go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add internal/auth/sso_store.go go.mod go.sum
git commit -m "feat: SSO config store and SAML/OIDC dependency installation"
```

---

## Task 6: SSO — SAML + OIDC Auth Handlers

**Files:**
- Create: `internal/auth/saml.go`
- Create: `internal/auth/oidc.go`
- Create: `internal/auth/sso_handler.go`
- Modify: `internal/server/routes.go` (add SSO routes to /auth group at line 50)

- [ ] **Step 1: Create SAML service**

`internal/auth/saml.go` — SP setup from SSOConfig, AuthnRequest generation, assertion parsing.

Key functions:
- `NewSAMLServiceProvider(cfg *SSOConfig) (*saml.ServiceProvider, error)` — creates SP from config
- `ParseSAMLAssertion(sp *saml.ServiceProvider, r *http.Request) (*saml.Assertion, error)` — validates and extracts assertion
- `ExtractSAMLUser(assertion *saml.Assertion) (email, name string, err error)` — gets user info from attributes

- [ ] **Step 2: Create OIDC service**

`internal/auth/oidc.go` — provider discovery, auth URL generation, token exchange.

Key functions:
- `NewOIDCProvider(ctx context.Context, issuerURL string) (*oidc.Provider, error)` — discovery
- `OIDCAuthURL(provider *oidc.Provider, clientID, redirectURL, state string, scopes []string) string` — generate auth URL
- `ExchangeOIDCCode(ctx context.Context, provider *oidc.Provider, oauth2Cfg *oauth2.Config, code string) (email, name string, err error)` — exchange code for ID token, extract claims

- [ ] **Step 3: Create SSO HTTP handlers**

`internal/auth/sso_handler.go` — handles all SSO endpoints:

- `HandleSSOLookup(w, r)` — GET `/auth/sso/lookup?email=user@co.com` → returns `{configured: true, provider_type: "saml", org_name: "..."}`
- `HandleSAMLLogin(w, r)` — initiates SAML flow based on email domain
- `HandleSAMLACS(w, r)` — SAML assertion consumer, creates/matches user, issues JWT, redirects to dashboard
- `HandleOIDCLogin(w, r)` — initiates OIDC flow for org
- `HandleOIDCCallback(w, r)` — exchanges code, creates/matches user, issues JWT, redirects to dashboard
- `HandleSSOConfigGet(w, r)` — GET `/api/sso` (owner only)
- `HandleSSOConfigUpsert(w, r)` — POST `/api/sso` (owner only)
- `HandleSSOConfigDelete(w, r)` — DELETE `/api/sso` (owner only)

User matching logic (shared between SAML and OIDC):
1. Extract email from assertion/ID token
2. Look up user by email in org
3. If not found → JIT provision: create user with default_role from SSO config
4. Issue JWT with user_id, org_id, role, email

- [ ] **Step 4: Register SSO routes**

In `routes.go`, add to the `/auth` group (line 50):

```go
s.router.Route("/auth", func(r chi.Router) {
    // Existing GitHub OAuth
    r.Post("/github", s.handleGitHubLogin)
    r.Get("/github/callback", s.handleGitHubCallback)

    // SSO
    r.Get("/sso/lookup", ssoHandler.HandleSSOLookup)
    r.Get("/saml/{orgID}/metadata", ssoHandler.HandleSAMLMetadata)
    r.Post("/saml/acs", ssoHandler.HandleSAMLACS)
    r.Get("/oidc/{orgID}/login", ssoHandler.HandleOIDCLogin)
    r.Get("/oidc/callback", ssoHandler.HandleOIDCCallback)
})

// SSO config management (owner only)
s.router.Route("/api", func(r chi.Router) {
    r.Use(middleware.JWTAuth(s.jwtManager))
    // ... existing routes ...

    r.Route("/sso", func(r chi.Router) {
        r.Use(middleware.RequireRole("owner"))
        r.Get("/", ssoHandler.HandleSSOConfigGet)
        r.Post("/", ssoHandler.HandleSSOConfigUpsert)
        r.Delete("/", ssoHandler.HandleSSOConfigDelete)
    })
})
```

- [ ] **Step 5: Test compilation + run tests**

```bash
go build ./...
set -a && source .env && set +a && go test ./... -count=1
```

- [ ] **Step 6: Commit**

```bash
git add internal/auth/saml.go internal/auth/oidc.go internal/auth/sso_handler.go internal/server/routes.go
git commit -m "feat: SAML and OIDC SSO authentication handlers with JIT provisioning"
```

---

## Task 7: Frontend — useAuth Hook + RequireRole Component

**Files:**
- Create: `web/hooks/use-auth.ts`
- Create: `web/components/require-role.tsx`
- Modify: `web/components/sidebar.tsx` (line 85-91, add SSO + Audit items)

- [ ] **Step 1: Create useAuth hook**

```typescript
// web/hooks/use-auth.ts
'use client';
import { useMemo } from 'react';

interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  role: string;
  isOwner: boolean;
  isAdmin: boolean;
  canWrite: boolean; // admin or owner
}

export function useAuth(): AuthContext | null {
  return useMemo(() => {
    if (typeof window === 'undefined') return null;
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const role = payload.role || 'viewer';
      return {
        userId: payload.user_id || '',
        orgId: payload.org_id || '',
        email: payload.email || '',
        role,
        isOwner: role === 'owner',
        isAdmin: role === 'admin' || role === 'owner',
        canWrite: role === 'admin' || role === 'owner',
      };
    } catch {
      return null;
    }
  }, []);
}
```

- [ ] **Step 2: Create RequireRole component**

```typescript
// web/components/require-role.tsx
'use client';
import { useAuth } from '@/hooks/use-auth';

const ROLE_LEVELS: Record<string, number> = {
  viewer: 1, member: 1, admin: 2, owner: 3,
};

interface Props {
  role: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function RequireRole({ role, children, fallback = null }: Props) {
  const auth = useAuth();
  const userLevel = ROLE_LEVELS[auth?.role || ''] || 0;
  const requiredLevel = ROLE_LEVELS[role] || 99;

  if (userLevel < requiredLevel) return <>{fallback}</>;
  return <>{children}</>;
}
```

- [ ] **Step 3: Add SSO and Audit Log to sidebar**

In `web/components/sidebar.tsx`, in the Settings section (around line 85-91), add:

```typescript
{ name: 'SSO', href: '/dashboard/settings/sso', icon: Shield },
{ name: 'Audit Log', href: '/dashboard/settings/audit', icon: FileText },
```

- [ ] **Step 4: Commit**

```bash
git add web/hooks/use-auth.ts web/components/require-role.tsx web/components/sidebar.tsx
git commit -m "feat: useAuth hook, RequireRole component, SSO and Audit sidebar items"
```

---

## Task 8: Frontend — SSO Settings Page + Audit Log Page

**Files:**
- Create: `web/app/dashboard/settings/sso/page.tsx`
- Create: `web/app/dashboard/settings/audit/page.tsx`

- [ ] **Step 1: Create SSO settings page**

Full page with:
- Provider type toggle (SAML / OIDC)
- SAML: fields for Entity ID, SSO URL, Certificate (textarea)
- OIDC: fields for Issuer URL, Client ID, Client Secret
- Common: Email domain input, Default role selector, Enforce SSO toggle, Enable/Disable toggle
- Save + Test Connection buttons
- SP metadata download link (for SAML)
- Follow existing settings page patterns (dark theme, card layout, form inputs)

- [ ] **Step 2: Create audit log page**

Full page with:
- Table: Time, User (email), Action, Resource Type, Resource ID, IP Address
- Server-side pagination (use same pattern as sessions page)
- Filters: action type dropdown, user dropdown
- Click row to expand details (JSONB)
- Framer Motion animations matching other pages

- [ ] **Step 3: Test pages load in browser**

Navigate to `http://localhost:3000/dashboard/settings/sso` and `http://localhost:3000/dashboard/settings/audit`.
Verify: pages render without errors, match dark theme, forms are interactive.

- [ ] **Step 4: Commit**

```bash
git add web/app/dashboard/settings/sso/ web/app/dashboard/settings/audit/
git commit -m "feat: SSO configuration page and audit log viewer"
```

---

## Task 9: E2E Tests + Verification

**Files:**
- Modify: `test_e2e.py`

- [ ] **Step 1: Add RBAC E2E tests**

```python
def test_rbac_viewer_blocked():
    print("\n--- RBAC Enforcement ---")
    # Create a viewer JWT for testing
    # (generate with Go helper or hardcode a test token)
    # Test that POST to mutation endpoints returns 403
    result = api("GET", "/api/audit-logs")
    check("Audit log endpoint exists", not result.get("_error") or result.get("_status") == 403)

def test_sso_lookup_no_config():
    print("\n--- SSO Lookup ---")
    result = api("GET", "/auth/sso/lookup?email=nobody@unknown-domain.com")
    check("SSO lookup returns for unknown domain",
          not result.get("_error"),
          result.get("_body", "")[:100] if result.get("_error") else "")

def test_audit_log_query():
    print("\n--- Audit Log ---")
    result = api("GET", "/api/audit-logs?page=1&per_page=10")
    check("Audit log query works",
          not result.get("_error") or result.get("_status") == 403,
          str(result.get("_status", "")))
```

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/harishtalluri/dev_fr/agentstack-fresh
go test ./... -count=1
cd sdk/python && python3 -m pytest tests/ -v
cd .. && python3 test_e2e.py
```

Expected: All existing tests still pass, new tests pass.

- [ ] **Step 3: Browser verify**

- SSO settings page renders with form
- Audit log page renders with table (may be empty)
- Viewer-role buttons are hidden on mutation pages
- Settings sidebar shows SSO and Audit Log items

- [ ] **Step 4: Commit**

```bash
git add test_e2e.py
git commit -m "test: add RBAC and SSO E2E tests"
```

- [ ] **Step 5: Final milestone commit**

```bash
git commit --allow-empty -m "milestone: Enterprise Auth (SAML/OIDC SSO, RBAC, Audit Logging) complete"
```

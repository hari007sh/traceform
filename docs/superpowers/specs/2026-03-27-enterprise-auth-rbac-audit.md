# Enterprise Auth, RBAC & Audit Logging

**Date:** 2026-03-27
**Status:** Approved
**Goal:** Add SAML/OIDC SSO, role-based access control (owner/admin/viewer), and audit logging so AgentStack passes enterprise security questionnaires.

---

## 1. SAML/OIDC SSO

### Overview

Add enterprise SSO alongside existing GitHub OAuth. Org admins configure their identity provider (Okta, Azure AD, Google Workspace) in Settings > SSO.

### Libraries

- `github.com/crewjam/saml` — SAML 2.0 Service Provider
- `github.com/coreos/go-oidc/v3` — OIDC provider discovery and token validation
- `golang.org/x/oauth2` — OAuth2 token exchange (used by OIDC)

### Authentication Flow

**SAML (SP-initiated):**
1. User clicks "Sign in with SSO" on login page
2. User enters email → backend looks up org's SSO config by email domain
3. Backend generates SAML AuthnRequest → redirects to IdP
4. IdP authenticates user → posts SAML assertion to ACS endpoint
5. Backend validates assertion, extracts email/name → creates or matches user
6. Backend issues JWT → redirects to dashboard

**OIDC:**
1. Same initial steps — email domain lookup finds OIDC config
2. Backend redirects to IdP's authorization endpoint
3. IdP authenticates → callback with authorization code
4. Backend exchanges code for ID token → validates claims
5. Same user matching and JWT issuance

**JIT Provisioning:** First SSO login auto-creates user record in the org with `viewer` role (configurable default in SSO settings).

**Domain enforcement:** Org admin can toggle "Require SSO for @domain.com" — if enabled, users with that email domain cannot use GitHub OAuth and must use SSO.

### Database

```sql
-- Migration: 012_sso_config.up.sql
CREATE TABLE IF NOT EXISTS sso_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('saml', 'oidc')),
    display_name TEXT NOT NULL DEFAULT '',

    -- SAML fields
    idp_metadata_xml TEXT,
    idp_entity_id TEXT,
    idp_sso_url TEXT,
    idp_certificate TEXT,
    sp_entity_id TEXT,
    sp_acs_url TEXT,

    -- OIDC fields
    oidc_issuer_url TEXT,
    oidc_client_id TEXT,
    oidc_client_secret_encrypted TEXT,
    oidc_scopes TEXT[] DEFAULT '{openid,profile,email}',

    -- Common
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

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/sso/lookup?email=user@co.com` | Public | Check if SSO is configured for email domain |
| POST | `/auth/saml/metadata/{org_id}` | Public | Serve SP metadata XML for SAML config |
| POST | `/auth/saml/acs` | Public | SAML assertion consumer service |
| GET | `/auth/oidc/{org_id}/login` | Public | Initiate OIDC auth flow |
| GET | `/auth/oidc/callback` | Public | OIDC callback handler |
| GET | `/api/sso` | Owner | Get org SSO configuration |
| POST | `/api/sso` | Owner | Create/update SSO configuration |
| DELETE | `/api/sso` | Owner | Remove SSO configuration |
| POST | `/api/sso/test` | Owner | Test SSO connection (dry run) |

### New Files

- `internal/auth/saml.go` — SAML SP setup, AuthnRequest generation, assertion parsing, user matching
- `internal/auth/oidc.go` — OIDC provider discovery, authorization flow, token validation, user matching
- `internal/auth/sso_store.go` — PostgreSQL CRUD for sso_configs table
- `internal/auth/sso_handler.go` — HTTP handlers for SSO endpoints

### Security

- OIDC client secrets encrypted with AES-256-GCM (reuse existing `EncryptionService` from route module)
- SAML assertions validated against IdP certificate
- SAML response replay protection via one-time-use assertion IDs (stored in Redis with TTL)
- State parameter for OIDC to prevent CSRF
- SSO configuration changes are audit logged

---

## 2. RBAC (Role-Based Access Control)

### Role Definitions (V1)

| Role | Dashboard | Sessions | Guard/Test | API Keys | SSO/Team | Billing |
|------|-----------|----------|------------|----------|----------|---------|
| `owner` | Full | Full | Full | Full | Full | Full |
| `admin` | Full | Full | Full | Create/Delete | View | No |
| `viewer` | Read | Read | Read | View own | No | No |

### Implementation

**Middleware:** `RequireRole(minRole string)` checks the JWT `role` claim against a role hierarchy:

```
owner > admin > viewer
```

If the user's role is >= the minimum required role, the request proceeds. Otherwise, 403 Forbidden.

**Route application:**

```go
// Owner-only routes
r.Route("/api/org", func(r chi.Router) {
    r.Use(middleware.RequireRole("owner"))
    // ...
})
r.Route("/api/sso", func(r chi.Router) {
    r.Use(middleware.RequireRole("owner"))
    // ...
})

// Admin+ routes (mutating operations)
r.Route("/v1/guard/rules", func(r chi.Router) {
    r.Get("/", ...) // All roles
    r.With(middleware.RequireRole("admin")).Post("/", ...)
    r.With(middleware.RequireRole("admin")).Put("/{id}", ...)
    r.With(middleware.RequireRole("admin")).Delete("/{id}", ...)
})

// Similar for: alert rules, test suites, providers, routes, webhooks, prompts, datasets
```

**Frontend enforcement:**
- Viewer role: mutation buttons (Create, Edit, Delete) are hidden or disabled
- Admin role: SSO/Billing tabs hidden in settings
- Store user role in React context from JWT claims
- `useAuth()` hook provides `{ role, canWrite, isOwner }` helpers

### Database (Future-proof)

```sql
-- Migration: 013_rbac.up.sql
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permissions TEXT[] NOT NULL DEFAULT '{}',
    is_system BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed system roles per org (done in application code on org creation)
-- V1: role enforcement uses org_members.role TEXT field directly
-- V1.1: custom roles use the roles table + permissions array
```

The `permissions` field is unused in V1 but the schema supports granular permissions for V1.1 without migration.

### New Files

- `internal/server/middleware/rbac.go` — `RequireRole` middleware + role hierarchy
- `web/hooks/use-auth.ts` — React hook for role-based UI rendering
- `web/components/require-role.tsx` — Wrapper component that hides children for insufficient role

---

## 3. Audit Logging

### What Gets Logged

Every mutating action by a user records:

| Category | Actions |
|----------|---------|
| Auth | SSO config changed, member invited, member removed, role changed |
| API Keys | Key created, key deleted |
| Guard | Rule created, updated, deleted |
| Test | Suite created, deleted, run started |
| Route | Provider created, updated, deleted; route created, updated, deleted |
| Cost | Budget policy created, updated, deleted |
| Webhooks | Endpoint created, updated, deleted |
| Prompts | Prompt created, updated, deployed, deleted |
| Datasets | Dataset created, updated, deleted |
| Settings | Org settings updated, retention changed |

### Database

```sql
-- Migration: 014_audit_logs.up.sql
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

### Implementation

**Service:**

```go
type AuditLogger struct {
    store *AuditStore
}

func (a *AuditLogger) Log(ctx context.Context, action, resourceType, resourceID string, details map[string]interface{}) {
    userID := middleware.GetUserID(ctx)
    orgID := middleware.GetOrgID(ctx)
    email := middleware.GetUserEmail(ctx)
    ip := middleware.GetClientIP(ctx)

    a.store.Insert(ctx, &AuditEntry{
        OrgID:        orgID,
        UserID:       userID,
        UserEmail:    email,
        Action:       action,
        ResourceType: resourceType,
        ResourceID:   resourceID,
        Details:      details,
        IPAddress:    ip,
    })
}
```

**Usage in handlers:** Called after successful mutations:

```go
func (h *RulesHandler) Create(w http.ResponseWriter, r *http.Request) {
    // ... create rule logic ...
    h.audit.Log(r.Context(), "created", "guard_rule", rule.ID, map[string]interface{}{
        "name": rule.Name,
        "type": rule.Type,
    })
}
```

**Query API:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/audit-logs` | Admin+ | List audit logs (paginated, filterable) |
| GET | `/api/audit-logs/{id}` | Admin+ | Get single audit entry with full details |

Query params: `page`, `per_page`, `user_id`, `action`, `resource_type`, `start`, `end`

### New Files

- `internal/audit/service.go` — AuditLogger service
- `internal/audit/store.go` — PostgreSQL store for audit_logs
- `internal/audit/handler.go` — HTTP handlers for audit log queries

---

## 4. Frontend Changes

### Login Page (`web/app/(auth)/login/page.tsx`)

- Add email input field for SSO lookup
- "Continue with SSO" button that calls `/auth/sso/lookup?email=...`
- If SSO configured → redirect to SAML/OIDC flow
- If not → show "No SSO configured for this domain" with fallback to GitHub
- Keep existing "Sign in with GitHub" button

### Settings > SSO (`web/app/dashboard/settings/sso/page.tsx` — new)

- Provider type selector (SAML / OIDC)
- SAML: metadata XML upload or manual config (Entity ID, SSO URL, Certificate)
- OIDC: Issuer URL, Client ID, Client Secret inputs
- Email domain input + "Enforce SSO" toggle
- Default role selector (viewer/admin)
- "Test Connection" button
- SP metadata download link (for SAML)

### Settings > Team (`web/app/dashboard/settings/team/page.tsx` — modify)

- Role column in members table
- Role change dropdown (owner only)
- Invite form includes role selector
- "Remove member" confirmation dialog

### Settings > Audit Log (`web/app/dashboard/settings/audit/page.tsx` — new)

- Timeline view of audit events
- Columns: Time, User, Action, Resource, IP Address
- Filterable by user, action type, date range
- Click to expand full details (JSONB)
- Server-side pagination

### Role-Based UI

- `useAuth()` hook reads role from JWT in localStorage
- `<RequireRole role="admin">` wrapper hides children for insufficient role
- All Create/Edit/Delete buttons wrapped with role check
- Settings sidebar: hide SSO/Billing tabs for non-owners

### New Files

- `web/app/dashboard/settings/sso/page.tsx` — SSO configuration UI
- `web/app/dashboard/settings/audit/page.tsx` — Audit log viewer
- `web/hooks/use-auth.ts` — Auth context + role helpers
- `web/components/require-role.tsx` — Conditional render by role

---

## 5. Testing

### Backend Tests

- `internal/auth/saml_test.go` — SAML assertion parsing with test fixtures
- `internal/auth/oidc_test.go` — OIDC token validation with mock provider
- `internal/server/middleware/rbac_test.go` — Role hierarchy + middleware enforcement
- `internal/audit/service_test.go` — Audit log recording + query

### E2E Tests (add to test_e2e.py)

- `test_rbac_viewer_cannot_create` — viewer role gets 403 on POST endpoints
- `test_rbac_admin_can_create` — admin role gets 201 on POST endpoints
- `test_audit_log_records_mutation` — create something, verify audit log entry
- `test_sso_lookup_no_config` — SSO lookup returns empty for unconfigured domain

### Frontend

- Verify role-based button visibility in browser
- Verify SSO settings page renders
- Verify audit log page loads and paginates

---

## 6. Files Changed Summary

| Category | New Files | Modified Files |
|----------|-----------|---------------|
| SAML/OIDC | `auth/saml.go`, `auth/oidc.go`, `auth/sso_store.go`, `auth/sso_handler.go` | `server/routes.go` |
| RBAC | `middleware/rbac.go` | `server/routes.go` (add RequireRole per group) |
| Audit | `audit/service.go`, `audit/store.go`, `audit/handler.go` | All mutation handlers (add audit.Log calls) |
| Migrations | `012_sso_config.up.sql`, `013_rbac.up.sql`, `014_audit_logs.up.sql` | — |
| Frontend | `settings/sso/page.tsx`, `settings/audit/page.tsx`, `hooks/use-auth.ts`, `components/require-role.tsx` | `login/page.tsx`, `settings/team/page.tsx`, sidebar, all mutation pages |

# Compliance Overview

This document describes the security controls and compliance posture of AgentStack. It is intended for security teams evaluating AgentStack for production use.

---

## Table of Contents

1. [Data Encryption](#1-data-encryption)
2. [Authentication](#2-authentication)
3. [Authorization](#3-authorization)
4. [Audit Logging](#4-audit-logging)
5. [Data Isolation](#5-data-isolation)
6. [Data Deletion (GDPR)](#6-data-deletion-gdpr)
7. [Network Security](#7-network-security)
8. [Monitoring](#8-monitoring)
9. [Dependency Management](#9-dependency-management)
10. [SOC 2 Readiness Checklist](#10-soc-2-readiness-checklist)

---

## 1. Data Encryption

### In Transit

All external communication uses TLS 1.2 or higher.

- **Production deployments** use Caddy as a reverse proxy, which obtains and renews Let's Encrypt certificates automatically. See `deploy/caddy/Caddyfile`.
- **Local development** uses Caddy's `tls internal` directive for self-signed certificates, or plain HTTP on localhost.
- **SDK-to-server** communication uses HTTPS in production. The SDKs validate TLS certificates by default.
- **Inter-service communication** (API server to PostgreSQL, ClickHouse, Redis, NATS) uses TLS when configured. In default Docker Compose development mode, these run on localhost without TLS.

### At Rest

| Data Store | Encryption |
|------------|-----------|
| PostgreSQL | Database-level encryption (supported by PostgreSQL TDE or cloud provider encryption, e.g., AWS RDS encryption at rest) |
| ClickHouse | Volume-level encryption via the host OS or cloud provider (e.g., encrypted EBS volumes) |
| Redis | In-memory only; persistence is optional and uses volume-level encryption |
| Provider API keys | Application-level encryption using AES-256-GCM before storage in PostgreSQL (see `internal/route/service/encryption.go`) |

### Key Management

- The `ENCRYPTION_KEY` environment variable holds the 32-byte hex key used for AES-256-GCM encryption of provider API keys.
- In production, this key should be stored in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) and injected at deploy time.
- Key rotation requires re-encrypting stored provider keys with the new key.

---

## 2. Authentication

AgentStack supports three authentication methods:

### JWT (Session-based)

- Issued after successful GitHub OAuth or SSO login.
- Signed with HS256 using the `JWT_SECRET` environment variable.
- Contains: user ID, organization ID, role, issued-at, expiration.
- Transmitted via HTTP-only secure cookie.
- Configurable expiration (default: 24 hours).

### API Keys

- Prefixed with `as_sk_` for identification.
- Stored as SHA-256 hashes in PostgreSQL; the plaintext key is shown once at creation time and never stored.
- Scoped to specific permissions: `ingest`, `query`, `admin`, `gateway`.
- No expiration by default; can be revoked at any time.
- Rate-limited independently via Redis sliding window.

### SSO (SAML / OIDC)

- Supports enterprise identity providers: Okta, Azure AD, Google Workspace.
- Configured via environment variables (`SSO_PROVIDER`, `SSO_ISSUER_URL`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`).
- Tokens from the IdP are validated server-side before issuing an AgentStack JWT.
- Supports Just-In-Time user provisioning.

---

## 3. Authorization

AgentStack uses role-based access control (RBAC) at the organization level.

| Role | Permissions |
|------|-------------|
| **Owner** | Full access. Manage billing, delete the organization, transfer ownership. |
| **Admin** | Manage team members, API keys, guardrails, routes, test suites, alert rules. Cannot delete the organization. |
| **Viewer** | Read-only access to sessions, analytics, test results, cost data. Cannot modify configuration. |

### Enforcement

- Every API handler checks the authenticated user's role before performing the operation.
- Role is embedded in the JWT and API key scope.
- Organization membership is verified on every request; users cannot access data from organizations they do not belong to.

---

## 4. Audit Logging

### What Is Logged

| Event Category | Examples |
|----------------|----------|
| Authentication | Login success/failure, OAuth flow completion, API key creation/revocation |
| Authorization | Permission denied events, role changes |
| Configuration changes | Guardrail rule creation/update/deletion, route changes, provider changes, test suite modifications |
| Data access | Session queries, analytics exports |
| Data deletion | GDPR deletion requests and completion |

### Storage and Retention

- Audit logs are written to PostgreSQL in the `audit_logs` table.
- Writes are asynchronous; a failed audit write never blocks the primary operation.
- Default retention: 90 days. Configurable per organization.
- Logs include: timestamp, actor (user ID or API key ID), action, resource type, resource ID, IP address, and a diff of changes where applicable.

### Access

- Audit logs are visible to owners and admins in the Settings > Audit Log page.
- Logs can be exported via the API: `GET /v1/audit-logs?from=2025-01-01&to=2025-01-31`.

---

## 5. Data Isolation

### Organization-Level Isolation

All data in AgentStack is scoped to an organization.

- Every database table that stores user data includes an `org_id` column.
- Every query includes an `org_id` filter derived from the authenticated user's JWT or API key.
- There is no cross-organization data access path in the application code.

### ClickHouse

- Time-series data (sessions, spans, events) is partitioned by organization and date.
- Queries against ClickHouse always include the `org_id` predicate.

### Redis

- Cache keys are prefixed with the organization ID: `org:{org_id}:rate:{key_id}`.
- Semantic cache entries are scoped to the organization.

---

## 6. Data Deletion (GDPR)

AgentStack provides endpoints for GDPR-compliant data deletion.

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `DELETE /v1/gdpr/sessions?before=<timestamp>` | Delete all sessions and associated spans/events older than the given timestamp |
| `DELETE /v1/gdpr/user/{user_id}` | Delete all data associated with a specific user |
| `DELETE /v1/gdpr/org/{org_id}` | Delete all data for an entire organization |

### Process

1. The deletion request is validated and recorded in the audit log.
2. Data is deleted from PostgreSQL (configuration, users, API keys).
3. Data is deleted from ClickHouse (sessions, spans, events, healing events, gateway logs).
4. Cache entries in Redis are purged.
5. A confirmation record is written to the audit log with the scope and row counts deleted.

### Data Subject Access Requests (DSAR)

- `GET /v1/gdpr/export/{user_id}` returns a JSON archive of all data associated with a user.
- The export includes: profile information, organization memberships, API keys (names only, not secrets), sessions, and audit log entries.

---

## 7. Network Security

### Security Headers

The Caddy reverse proxy and the Go API server set the following headers:

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-XSS-Protection` | `1; mode=block` |

### Rate Limiting

- All API endpoints are rate-limited using a Redis-backed sliding window algorithm.
- Limits are per API key (or per IP for unauthenticated endpoints).
- Default: 60 requests/second per key with burst allowance of 120.
- Rate limit headers are returned on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- Exceeding the limit returns `429 Too Many Requests`.

### Request Body Limits

- Maximum request body size: 10 MB (configurable).
- The gateway proxy enforces a separate limit for LLM request/response payloads.

### CORS

- Allowed origins are configured via `FRONTEND_URL`.
- Credentials (cookies) are allowed only for the configured origin.
- Pre-flight requests are cached for 12 hours.

---

## 8. Monitoring

### Prometheus Metrics

The API server exposes a `/metrics` endpoint in Prometheus format:

| Metric | Type | Description |
|--------|------|-------------|
| `agentstack_http_requests_total` | Counter | Total HTTP requests by method, path, and status code |
| `agentstack_http_request_duration_seconds` | Histogram | Request latency distribution |
| `agentstack_ingest_events_total` | Counter | Total ingested events by type |
| `agentstack_ingest_batch_size` | Histogram | Batch sizes written to ClickHouse |
| `agentstack_gateway_requests_total` | Counter | Gateway proxy requests by provider and model |
| `agentstack_gateway_latency_seconds` | Histogram | Gateway proxy latency (excluding upstream LLM time) |
| `agentstack_guard_checks_total` | Counter | Guardrail checks by rule and result (pass/block) |
| `agentstack_nats_pending_messages` | Gauge | Messages pending in NATS JetStream |

### Health Checks

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Returns `200 OK` with service status and dependency health (PostgreSQL, ClickHouse, Redis, NATS) |

The health check response includes the status of each dependency:

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "dependencies": {
    "postgres": "healthy",
    "clickhouse": "healthy",
    "redis": "healthy",
    "nats": "healthy"
  }
}
```

### Alerting

- Alert rules can be configured in the dashboard to fire on failure rate thresholds, latency spikes, cost overruns, or pattern matches.
- Alerts are delivered via email (SendGrid) and webhook.

---

## 9. Dependency Management

### Go (Backend)

- Dependencies are tracked in `go.mod` and `go.sum` with exact version pinning.
- `go vet` and `golangci-lint` run as part of the CI pipeline.
- Dependencies are reviewed before upgrading.

### Node.js (Dashboard)

- Dependencies are tracked in `package.json` and locked in `package-lock.json`.
- Only production dependencies are included in the Docker image (`npm ci --production`).

### Container Images

- Base images use minimal Alpine variants (`caddy:2-alpine`, `redis:7-alpine`).
- Application containers use multi-stage builds; the final image contains only the compiled binary (Go) or the production build (Next.js).
- No development tools, compilers, or source code are present in production images.

---

## 10. SOC 2 Readiness Checklist

SOC 2 Type II compliance covers five trust service criteria. Below is the current status for each area.

### Security (Common Criteria)

| Control | Status | Notes |
|---------|--------|-------|
| TLS in transit | Done | Caddy auto-TLS, HSTS headers |
| Encryption at rest | Done | AES-256-GCM for secrets, volume encryption for databases |
| Authentication | Done | JWT, API keys, SSO |
| Authorization (RBAC) | Done | Owner/Admin/Viewer roles |
| Rate limiting | Done | Redis sliding window |
| Security headers | Done | HSTS, X-Content-Type-Options, X-Frame-Options |
| Input validation | Done | All handlers validate input, parameterized queries |
| Secrets management | Done | API keys hashed, provider keys encrypted |
| Vulnerability reporting | Done | SECURITY.md with response SLA |

### Availability

| Control | Status | Notes |
|---------|--------|-------|
| Health checks | Done | `/health` endpoint with dependency status |
| Auto-restart | Done | Docker `restart: unless-stopped` |
| Horizontal scaling | Partial | API server is stateless; needs load balancer configuration |
| Disaster recovery | Needs auditor | Backup/restore procedures for PostgreSQL and ClickHouse |
| Uptime monitoring | Needs auditor | Requires external monitoring (e.g., Pingdom, UptimeRobot) |

### Processing Integrity

| Control | Status | Notes |
|---------|--------|-------|
| Input validation | Done | All endpoints validate and return structured errors |
| Idempotent ingestion | Done | Duplicate span IDs are handled gracefully |
| Async pipeline reliability | Done | NATS JetStream with at-least-once delivery |
| Test suite framework | Done | Built-in evaluators with CI/CD quality gates |

### Confidentiality

| Control | Status | Notes |
|---------|--------|-------|
| Data isolation | Done | Organization-level scoping on all queries |
| API key scoping | Done | Granular scopes (ingest, query, admin, gateway) |
| Audit logging | Done | All configuration changes logged |
| Minimal data collection | Done | SDK sends only what the user instruments |

### Privacy

| Control | Status | Notes |
|---------|--------|-------|
| GDPR deletion endpoints | Done | `/v1/gdpr/sessions`, `/v1/gdpr/user/{id}`, `/v1/gdpr/org/{id}` |
| Data export (DSAR) | Done | `/v1/gdpr/export/{user_id}` |
| PII detection guardrail | Done | Regex-based PII detection in Guard module |
| Data retention policies | Partial | Configurable retention; needs automated enforcement |
| Data Processing Agreement | Done | See `docs/security/data-processing-agreement.md` |

### What Needs an Auditor

The following items require a qualified third-party auditor for SOC 2 Type II certification:

1. **Formal risk assessment** and risk treatment plan
2. **Penetration testing** by an independent security firm
3. **Business continuity and disaster recovery** plan with tested runbooks
4. **Employee security training** documentation and records
5. **Vendor management** process for sub-processors
6. **Change management** process with formal approval workflows
7. **Incident response plan** with defined roles and communication procedures
8. **Evidence collection** over the audit period (typically 6-12 months of logs)

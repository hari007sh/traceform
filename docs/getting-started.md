# Getting Started with AgentStack

AgentStack is an open-source platform for running AI agents in production. It replaces five or six separate tools (Langfuse, DeepEval, Portkey, Guardrails AI, and custom glue code) with a single unified system covering observability, self-healing, testing, guardrails, model routing, and cost intelligence.

---

## Table of Contents

1. [Quick Start (5 minutes)](#quick-start-5-minutes)
2. [SDK Integration (Python)](#sdk-integration-python)
3. [SDK Integration (TypeScript)](#sdk-integration-typescript)
4. [Gateway Setup](#gateway-setup)
5. [Dashboard Tour](#dashboard-tour)
6. [API Authentication](#api-authentication)
7. [Configuration](#configuration)

---

## Quick Start (5 minutes)

### Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Docker & Docker Compose | 20.10+ | `docker --version` |
| Go | 1.22+ | `go version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |

### 1. Clone the repository

```bash
git clone https://github.com/agentstack/agentstack.git
cd agentstack
```

### 2. Start infrastructure services

```bash
docker compose up -d
```

This starts PostgreSQL, ClickHouse, Redis, and NATS. Wait until all services are healthy:

```bash
docker compose ps
```

All services should show `healthy` in the STATUS column.

### 3. Run database migrations and seed data

```bash
make migrate
make seed
```

The `seed` command loads 50+ failure patterns, 15 pre-built evaluators, 8 guardrail templates, and current model pricing.

### 4. Start the development servers

Open three terminal windows:

```bash
# Terminal 1 — API server (port 8080)
make dev

# Terminal 2 — Gateway proxy (port 8090)
make gateway

# Terminal 3 — Next.js dashboard (port 3000)
cd web && npm install && npm run dev
```

### 5. Open the dashboard

Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

---

## SDK Integration (Python)

### Install

```bash
pip install agentstack
```

### Initialize the SDK

```python
import agentstack

agentstack.init(
    api_key="as_sk_your_api_key_here",
    endpoint="http://localhost:8080",  # omit for cloud
)
```

### Create a traced session

```python
with agentstack.session(agent_name="my-agent") as session:
    with session.span("llm-call", span_type="llm_call") as span:
        span.set_input({"prompt": "Summarize this document"})
        result = call_your_llm(...)
        span.set_output(result)
        span.set_tokens(prompt=320, completion=150)
```

### Use the `@trace` decorator

```python
@agentstack.trace(span_type="llm_call")
def call_gpt(prompt: str) -> str:
    response = openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content
```

Every call to `call_gpt` is automatically traced with timing, token counts, and error capture.

### Enable Shield (self-healing)

Shield detects and auto-fixes loops, hallucinations, cost overruns, and timeouts at runtime.

```python
agentstack.protect({
    "loop_threshold": 3,       # break after 3 repeated outputs
    "cost_limit_cents": 500,   # halt if session exceeds $5.00
    "timeout_seconds": 120,    # kill stuck calls after 2 minutes
})
```

Once enabled, Shield wraps all traced spans and intervenes automatically.

### Run a guardrail check

```python
import asyncio

result = asyncio.run(agentstack.guard.check(
    content="The user's SSN is 123-45-6789",
    rules=["pii_detection"],
))

if not result["passed"]:
    print("Guardrail blocked:", result["results"])
```

---

## SDK Integration (TypeScript)

### Install

```bash
npm install @agentstack/sdk
```

### Initialize the SDK

```typescript
import { init, session, protect } from '@agentstack/sdk';

init({
  apiKey: process.env.AGENTSTACK_API_KEY!,
  projectId: 'my-project',
  endpoint: 'http://localhost:8080', // omit for cloud
});
```

### Create a traced session

```typescript
import { session, SpanType } from '@agentstack/sdk';

const sess = session({ agentName: 'my-agent' });
sess.start();

const span = sess.span('llm-call', { type: SpanType.LLM });
span.setInput({ prompt: 'Summarize this document' });

const result = await callYourLLM();

span.setOutput(result);
span.setTokens({ prompt: 320, completion: 150 });
span.end();

sess.end();
```

### Enable Shield (self-healing)

```typescript
protect({
  loopThreshold: 3,
  costLimitCents: 500,
  timeoutSeconds: 120,
});
```

### Run a guardrail check

```typescript
import { guard } from '@agentstack/sdk';

const result = await guard.check({
  content: "The user's SSN is 123-45-6789",
  rules: ['pii_detection'],
});

if (!result.passed) {
  console.error('Guardrail blocked:', result.results);
}
```

---

## Gateway Setup

The gateway is an OpenAI-compatible proxy that adds model routing, provider failover, semantic caching, and guardrail enforcement to any LLM call.

### 1. Add a provider

```bash
curl -X POST http://localhost:8080/v1/gateway/providers \
  -H "Authorization: Bearer as_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "openai-primary",
    "type": "openai",
    "api_key": "sk-your-openai-key",
    "models": ["gpt-4o", "gpt-4o-mini"],
    "is_active": true
  }'
```

### 2. Add a routing rule

```bash
curl -X POST http://localhost:8080/v1/gateway/routes \
  -H "Authorization: Bearer as_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "default-route",
    "match_model": "gpt-4o",
    "provider_id": "<provider-id-from-step-1>",
    "strategy": "single",
    "is_active": true
  }'
```

### 3. Send a request through the gateway

The gateway listens on port 8090 and is a drop-in replacement for the OpenAI API:

```bash
curl http://localhost:8090/v1/chat/completions \
  -H "Authorization: Bearer as_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "What is AgentStack?"}
    ]
  }'
```

To use the gateway from the OpenAI Python SDK, just change the base URL:

```python
import openai

client = openai.OpenAI(
    api_key="as_sk_your_api_key",
    base_url="http://localhost:8090/v1",
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

---

## Dashboard Tour

### Overview

The overview page shows four key metrics at a glance:

| Metric | Description |
|--------|-------------|
| **Total Sessions** | Number of agent sessions in the selected time range |
| **Failure Rate** | Percentage of sessions that ended in error or timeout |
| **Avg Latency** | Mean end-to-end session duration |
| **Total Cost** | Aggregate LLM spend across all sessions |

Below the metrics you will find a failure-rate trend chart and a recent sessions table.

### Sessions Explorer

The sessions page uses a split-pane layout:

- **Left pane** — filterable, scrollable session list with status badges, duration, and cost
- **Right pane** — session detail with a D3.js Gantt timeline showing every span

Keyboard shortcuts:

| Key | Action |
|-----|--------|
| `j` / `k` | Move selection down / up |
| `Enter` | Open selected session detail |
| `Esc` | Close detail pane |
| `/` | Focus the search filter |

Filter by status (completed, failed, timeout, healed), agent name, date range, or minimum cost.

### Cost Intelligence

- **Spend overview** with daily and cumulative trend lines
- **Cost per outcome** — see how much successful sessions cost versus failed ones
- **Model comparison** — side-by-side cost and quality metrics for each model
- **Budget policies** — set spending limits with progress bars and alert thresholds

### Guardrails

- View all configured guardrail rules and their pass/block rates
- Test a rule interactively by entering sample text and running a check
- See a timeline of recent guard events with block reasons

### Test Suites

- Create test suites with test cases pulled from production sessions
- Run evaluations using 15+ built-in evaluators (LLM-judge and programmatic)
- Track pass rates over time and set CI/CD quality gates

---

## API Authentication

AgentStack supports three authentication methods.

### GitHub OAuth

1. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in your environment.
2. Direct the user to `/auth/github` — this starts the OAuth flow.
3. On success, the callback at `/auth/github/callback` issues a JWT stored as an HTTP-only cookie.

### SSO (SAML / OIDC)

For enterprise deployments, configure SSO by setting:

```bash
SSO_PROVIDER=okta              # or "azure-ad", "google-workspace", "custom"
SSO_ISSUER_URL=https://your-idp.example.com
SSO_CLIENT_ID=your-client-id
SSO_CLIENT_SECRET=your-client-secret
SSO_CALLBACK_URL=https://app.agentstack.dev/auth/sso/callback
```

Users hitting `/auth/sso` are redirected to the identity provider. On success they receive a JWT just like the OAuth flow.

### API Keys

API keys are the primary method for SDK and programmatic access.

**Create a key** in the dashboard under Settings > API Keys, or via the API:

```bash
curl -X POST http://localhost:8080/v1/api-keys \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-ingest",
    "scopes": ["ingest", "query"]
  }'
```

Response:

```json
{
  "id": "ak_abc123",
  "key": "as_sk_live_xxxxxxxxxxxxxxxxxxxx",
  "name": "production-ingest",
  "scopes": ["ingest", "query"],
  "created_at": "2025-01-15T10:30:00Z"
}
```

**Use the key** by passing it in the `Authorization` header:

```bash
curl -H "Authorization: Bearer as_sk_live_xxxxxxxxxxxxxxxxxxxx" \
  http://localhost:8080/v1/sessions
```

Available scopes:

| Scope | Grants |
|-------|--------|
| `ingest` | Send trace spans, healing events, cost events |
| `query` | Read sessions, analytics, patterns |
| `admin` | Manage guardrails, routes, test suites, team members |
| `gateway` | Send requests through the gateway proxy |

---

## Configuration

### Environment Variables Reference

#### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | API server listen port |
| `GATEWAY_PORT` | `8090` | Gateway proxy listen port |
| `ENVIRONMENT` | `development` | `development` or `production` |

#### Databases

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://agentstack:agentstack_dev@localhost:5432/agentstack?sslmode=disable` | PostgreSQL connection string |
| `CLICKHOUSE_URL` | `clickhouse://localhost:9000/agentstack` | ClickHouse connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `NATS_URL` | `nats://localhost:4222` | NATS connection string |

#### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_CLIENT_ID` | — | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth app client secret |
| `JWT_SECRET` | `dev-secret-change-in-production` | Secret for signing JWTs (change in production) |
| `ENCRYPTION_KEY` | — | 32-byte hex string for AES-256-GCM encryption of provider API keys |

#### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `FRONTEND_URL` | `http://localhost:3000` | Used for CORS and OAuth redirects |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | API URL exposed to the browser |

#### Alerts

| Variable | Default | Description |
|----------|---------|-------------|
| `SENDGRID_API_KEY` | — | SendGrid API key for email alerts |
| `FROM_EMAIL` | `alerts@agentstack.dev` | Sender address for alert emails |

#### Storage and Sampling

| Variable | Default | Description |
|----------|---------|-------------|
| `BLOB_STORE_TYPE` | `fs` | `fs` for filesystem, `s3` for S3-compatible storage |
| `BLOB_STORE_PATH` | `/tmp/agentstack/payloads` | Filesystem path when using `fs` storage |
| `DEFAULT_SAMPLE_RATE` | `1.0` | Trace sampling rate (0.0 to 1.0) |
| `ADAPTIVE_THRESHOLD` | `100000` | Hourly ingest count before adaptive sampling kicks in |

### Docker Compose Customization

The default `docker-compose.yml` starts all infrastructure services. To customize:

```yaml
# Override resource limits
services:
  clickhouse:
    deploy:
      resources:
        limits:
          memory: 8G   # increase from default 4G for large datasets
          cpus: "4"
```

Use a compose override file to avoid editing the base file:

```bash
# docker-compose.override.yml is automatically picked up
docker compose up -d
```

### Production Deployment

#### Helm Chart

A Helm chart is available in `deploy/helm/agentstack/`:

```bash
helm install agentstack deploy/helm/agentstack \
  --namespace agentstack \
  --create-namespace \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.encryptionKey="$(openssl rand -hex 16)" \
  --set config.githubClientId="your-client-id" \
  --set config.githubClientSecret="your-client-secret"
```

#### TLS with Caddy

A Caddy reverse proxy configuration is provided in `deploy/caddy/`:

```bash
# Start Caddy alongside the app
docker compose -f docker-compose.yml \
  -f deploy/caddy/docker-compose.caddy.yml up -d
```

Caddy automatically obtains Let's Encrypt certificates for the configured domain. For local development, it generates self-signed certificates via `tls internal`.

See `deploy/caddy/Caddyfile` for the full routing configuration.

#### Production Dockerfiles

Three Dockerfiles are provided in `deploy/`:

| Dockerfile | Image | Description |
|------------|-------|-------------|
| `Dockerfile` | `agentstack/api` | Multi-stage Go build for the API server + worker |
| `Dockerfile.gateway` | `agentstack/gateway` | Gateway proxy binary |
| `Dockerfile.web` | `agentstack/web` | Next.js production build |

Build and run:

```bash
docker build -f deploy/Dockerfile -t agentstack/api .
docker build -f deploy/Dockerfile.gateway -t agentstack/gateway .
docker build -f deploy/Dockerfile.web -t agentstack/web .
```

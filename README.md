<div align="center">

# Traceform

**The self-healing platform for AI agents**

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL_1.1-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![GitHub Stars](https://img.shields.io/github/stars/hari007sh/traceform?style=social)](https://github.com/hari007sh/traceform)
[![Docker Pulls](https://img.shields.io/docker/pulls/traceform/traceform)](https://hub.docker.com/r/traceform/traceform)

One platform to observe, heal, test, guard, route, and cost-manage your AI agents in production.

[Getting Started](#quick-start) &middot; [Docs](docs/getting-started.md) &middot; [Architecture](#architecture) &middot; [Contributing](#contributing)

</div>

---

```
┌─ Shield ──┐  ┌─ Trace ──┐  ┌─ Test ───┐  ┌─ Guard ──┐  ┌─ Route ──┐  ┌─ Cost ───┐
│ Self-heal │  │ Observe  │  │ Evaluate │  │ Protect  │  │ Route    │  │ Track    │
│ agents    │  │ sessions │  │ quality  │  │ inputs   │  │ LLM calls│  │ spending │
└───────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

## Why Traceform?

- **Self-healing agents.** Shield detects loops, hallucinations, cost overruns, and timeouts at runtime and fixes them automatically. No other platform does this.
- **One platform, not six tools.** Traceform replaces Langfuse + DeepEval + Portkey + Guardrails AI + custom dashboards with a single self-hosted stack.
- **Open source, self-hosted.** Your data stays on your infrastructure. BSL 1.1 licensed, converts to Apache 2.0 after four years.

### How does Traceform compare?

| | Traceform | Langfuse | Datadog LLM Obs |
|---|---|---|---|
| Self-healing (Shield) | Yes | No | No |
| Tracing & session replay | Yes | Yes | Yes |
| Guardrails engine | Built-in | No | No |
| LLM gateway with failover | Built-in | No | No |
| Eval / CI quality gates | Built-in | Limited | No |
| Cost intelligence & budgets | Built-in | Basic | Yes |
| Self-hosted | Yes | Yes | No |
| Pricing | Free (self-host) | Free tier + paid | Per-host pricing |

---

## Quick Start

Clone the repo and start all services with Docker Compose:

```bash
git clone https://github.com/hari007sh/traceform.git
cd traceform
cp .env.example .env
docker compose up -d          # PostgreSQL, ClickHouse, Redis, NATS
make migrate && make seed     # Database setup
make dev                      # API server on :8080

# In another terminal:
cd web && npm install && PORT=3000 npm run dev   # Dashboard on :3000
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard. The API is available at [http://localhost:8080](http://localhost:8080/health).

---

## Architecture

```
                    ┌──────────────────────────┐
                    │      SDK (Python / TS)    │
                    │  Shield  Trace  Guard     │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
              ▼                  ▼                   ▼
   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
   │  API Server    │  │    Gateway     │  │    Worker      │
   │  :8080         │  │    :8090       │  │  (background)  │
   │                │  │                │  │                │
   │  REST API for  │  │  OpenAI-compat │  │  NATS consumer │
   │  all 6 modules │  │  LLM proxy     │  │  batch writes  │
   └───┬───┬───┬────┘  └───────┬────────┘  └───┬────────────┘
       │   │   │                │                │
       │   │   └────────────────┼────────────────┘
       │   │                    │
  ┌────▼───▼────┐  ┌───────────▼───┐  ┌────────┐  ┌────────┐
  │ PostgreSQL  │  │  ClickHouse   │  │ Redis  │  │  NATS  │
  │ :5432       │  │  :9000        │  │ :6379  │  │ :4222  │
  │             │  │               │  │        │  │        │
  │ Config,     │  │ Sessions,     │  │ Cache, │  │ Event  │
  │ users,      │  │ spans,        │  │ rate   │  │ stream │
  │ rules       │  │ events        │  │ limits │  │ async  │
  └─────────────┘  └───────────────┘  └────────┘  └────────┘

              ┌────────────────────────────┐
              │     Web Dashboard :3000    │
              │     Next.js 16 / React 19  │
              └────────────────────────────┘
```

---

## The Six Modules

### 1. Shield -- Self-Healing SDK

Auto-detects and fixes agent failures at runtime: infinite loops, hallucinations, cost overruns, and timeouts. The SDK intercepts problems before they reach your users. **No other platform offers this.**

### 2. Trace -- Session Explorer

Full observability for every agent session. Split-pane UI with infinite scroll, D3.js Gantt timeline, keyboard navigation, and failure pattern detection across your fleet.

### 3. Test -- Evaluation & CI/CD Quality Gates

15+ built-in evaluators (LLM-judge and programmatic). Run test suites in CI with pass/fail thresholds:

```bash
traceform test run --suite my-suite --ci --threshold 95 --format junit
```

### 4. Guard -- Guardrails Engine

PII detection, prompt injection defense, toxicity filtering, hallucination checks, and custom policies. Guards execute in parallel with short-circuit on block.

### 5. Route -- LLM Gateway

OpenAI-compatible proxy with circuit breakers, singleflight caching, provider failover (OpenAI, Anthropic, Google, Together, Groq, Mistral), and async request logging. Adds less than 5ms overhead.

### 6. Cost -- Cost Intelligence

Per-outcome cost tracking, budget enforcement, model comparison, and data export. Set budget policies and get alerts before you overspend.

---

## SDK Installation

```bash
# Python
pip install traceform

# TypeScript
npm install @traceform/sdk
```

### Quick Usage (Python)

```python
import traceform

traceform.init(api_key="tf_sk_...", endpoint="http://localhost:8080")

@traceform.trace(healing=True)
def run_agent(prompt: str):
    # Your agent logic here -- Shield auto-heals failures
    return agent.run(prompt)
```

### Gateway -- Zero-Code Integration

Point any OpenAI-compatible client at the Traceform gateway. No SDK changes required:

```python
from openai import OpenAI

client = OpenAI(
    api_key="tf_sk_...",
    base_url="http://localhost:8090/v1"
)

# Automatic routing, guardrails, caching, cost tracking, and failover
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}]
)
```

---

## Enterprise Features

| Feature | Community (Free) | Team ($199/mo) | Enterprise (Custom) |
|---------|:---:|:---:|:---:|
| All 6 modules | Yes | Yes | Yes |
| Self-hosted | Yes | Yes | Yes |
| SSO (SAML / OIDC) | -- | -- | Yes |
| RBAC (Owner / Admin / Viewer) | Yes | Yes | Yes |
| Audit logging | -- | Yes | Yes |
| Data export (CSV / JSON) | Yes | Yes | Yes |
| Error grouping & patterns | Yes | Yes | Yes |
| Priority support | -- | Yes | Yes |
| SLA & custom integrations | -- | -- | Yes |

---

## Deployment Options

| Method | Time | Best For |
|--------|------|----------|
| Docker Compose | 5 min | Development, small teams |
| Docker + Caddy | 15 min | Single-server production |
| Helm Chart | 30 min | Kubernetes production |

---

## Services Reference

| Service | Port | Purpose | Required? |
|---------|------|---------|-----------|
| API Server | 8080 | REST API for all modules | Yes |
| Gateway | 8090 | OpenAI-compatible LLM proxy | Optional (for Route module) |
| Worker | -- | Background jobs (NATS consumer, batch writes) | Yes |
| Web Dashboard | 3000 | Next.js UI | Yes |
| PostgreSQL | 5432 | Config, users, rules, budgets | Yes |
| ClickHouse | 9000 | Sessions, spans, events (time-series) | Yes |
| Redis | 6379 | Cache, rate limiting, session store | Yes |
| NATS | 4222 | Event streaming, async ingestion | Yes |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API & Gateway | Go 1.26, chi router |
| Web Dashboard | Next.js 16, React 19 |
| UI Components | Tailwind CSS, shadcn/ui |
| Animations | Framer Motion |
| Visualizations | D3.js |
| Time-Series Storage | ClickHouse |
| Relational Storage | PostgreSQL 16 |
| Cache & Rate Limiting | Redis 7 |
| Event Streaming | NATS (JetStream) |
| SDKs | Python 3.9+, TypeScript (Node 18+) |
| Containerization | Docker, Docker Compose |

---

## Documentation

- [Getting Started](docs/getting-started.md)
- [Architecture](docs/content/docs/architecture.mdx)
- [API Reference](docs/api/openapi.yaml)
- [Deployment Guide](docs/content/docs/deployment.mdx)
- [Integration Guides](docs/content/docs/integrations/)

---

## Contributing

We welcome contributions. Here is how to get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes with tests
4. Run the test suite: `make test && cd sdk/python && pytest && cd ../typescript && npm test`
5. Commit using conventional commits: `feat(module): description`
6. Open a pull request

Please read the project [CLAUDE.md](CLAUDE.md) for detailed coding standards, design system specifications, and quality requirements.

---

## License

Traceform is licensed under the [Business Source License 1.1](LICENSE).

**What this means:**
- **Self-host freely.** Run Traceform on your own infrastructure for any purpose.
- **Cannot offer as a competing managed service.** You may not host Traceform as a SaaS product that competes with Traceform Cloud.
- **Converts to Apache 2.0** after four years, becoming fully permissive open source.

This is the same license model used by MariaDB, CockroachDB, Sentry, and HashiCorp.

---

<div align="center">

[traceform.dev](https://traceform.dev) &middot; [Documentation](https://docs.traceform.dev) &middot; [Twitter](https://twitter.com/traceformdev) &middot; [Discord](https://discord.gg/traceform)

Built with Go, Next.js, ClickHouse, and a lot of care.

</div>

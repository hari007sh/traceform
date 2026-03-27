# Troubleshooting

Common issues and how to fix them.

---

## Table of Contents

1. [Cannot connect to ClickHouse](#1-cannot-connect-to-clickhouse)
2. [Sessions not appearing in the dashboard](#2-sessions-not-appearing-in-the-dashboard)
3. [Playground shows no providers](#3-playground-shows-no-providers)
4. [CORS errors in the browser](#4-cors-errors-in-the-browser)
5. [Rate limited (429 responses)](#5-rate-limited-429-responses)
6. [Port conflicts](#6-port-conflicts)
7. [Migration failures](#7-migration-failures)
8. [JWT expired or invalid](#8-jwt-expired-or-invalid)

---

## 1. Cannot connect to ClickHouse

**Symptoms:** API returns `500` on session queries. Server logs show `dial tcp: connection refused` or `clickhouse: connect failed`.

**Check the service:**

```bash
docker compose ps clickhouse
```

If the status is not `healthy`, restart it:

```bash
docker compose restart clickhouse
```

**Verify the port:**

ClickHouse uses two ports: `9000` (native protocol, used by the Go driver) and `8123` (HTTP interface). Make sure nothing else is bound to port 9000:

```bash
lsof -i :9000
```

**Test connectivity manually:**

```bash
docker compose exec clickhouse clickhouse-client --query "SELECT 1"
```

If this returns `1`, ClickHouse is running. Check that `CLICKHOUSE_URL` in your environment matches the expected format:

```
clickhouse://localhost:9000/agentstack
```

**Common causes:**
- ClickHouse ran out of memory (default limit is 4 GB). Increase the limit in `docker-compose.yml` or `docker-compose.override.yml`.
- The `agentstack` database does not exist. Run `make migrate` to create it.

---

## 2. Sessions not appearing in the dashboard

**Symptoms:** The SDK reports success, but sessions do not show up in the dashboard.

**Step 1 — Check NATS:**

Spans are ingested asynchronously via NATS. If NATS is down, spans queue in the SDK and never reach ClickHouse.

```bash
docker compose ps nats
```

Verify NATS is healthy, then check the monitoring endpoint:

```bash
curl http://localhost:8222/jsz
```

Look for `streams` and `consumers` — there should be at least one stream for ingest.

**Step 2 — Check the worker:**

The worker process consumes from NATS and writes to ClickHouse in batches. If the worker is not running, data sits in NATS.

```bash
# Start the worker if it is not running
make worker
```

Check worker logs for errors (connection failures, batch write errors).

**Step 3 — Batch flush timing:**

The SDK batches events before sending. By default, it flushes every 5 seconds or when the batch reaches 50 events. If you are testing with a single span, either:

- Wait 5 seconds for the automatic flush, or
- Call the flush method explicitly:

```python
# Python
agentstack._client.flush()
```

```typescript
// TypeScript — the client exposes flush()
import { getGlobalClient } from '@agentstack/sdk';
getGlobalClient()?.flush();
```

**Step 4 — Check ClickHouse directly:**

```bash
docker compose exec clickhouse clickhouse-client \
  --query "SELECT count() FROM agentstack.sessions"
```

If the count is non-zero but the dashboard shows nothing, the issue is on the query or frontend side. Check the API server logs and the browser console.

---

## 3. Playground shows no providers

**Symptoms:** The gateway playground or route configuration page shows an empty provider list.

**Check your auth token:**

Provider management requires an authenticated request with the `admin` scope.

```bash
curl -H "Authorization: Bearer as_sk_your_api_key" \
  http://localhost:8080/v1/gateway/providers
```

If you get `401 Unauthorized`, generate a new API key with admin scope from Settings > API Keys.

**Add a provider via the API:**

```bash
curl -X POST http://localhost:8080/v1/gateway/providers \
  -H "Authorization: Bearer as_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "openai",
    "type": "openai",
    "api_key": "sk-your-key",
    "models": ["gpt-4o", "gpt-4o-mini"],
    "is_active": true
  }'
```

**Check that the encryption key is set:**

Provider API keys are encrypted with AES-256-GCM before storage. If `ENCRYPTION_KEY` is not set, the server may reject provider creation. Set it to a 32-byte hex string:

```bash
export ENCRYPTION_KEY=$(openssl rand -hex 16)
```

---

## 4. CORS errors in the browser

**Symptoms:** The browser console shows `Access to fetch at 'http://localhost:8080/...' has been blocked by CORS policy`.

**Set the frontend URL:**

The API server reads `FRONTEND_URL` to build the CORS allow-origin list. Make sure it matches the URL where the dashboard runs:

```bash
export FRONTEND_URL=http://localhost:3000
```

If the dashboard runs on a different port (for example, Next.js picked `3001` because `3000` was busy), update the variable accordingly:

```bash
export FRONTEND_URL=http://localhost:3001
```

**Multiple origins:**

If you need to allow additional origins (for example, a staging deployment), the CORS middleware in `internal/server/middleware/cors.go` accepts a comma-separated list. You may need to add your origin there and restart the server.

**Caddy proxy:**

When running behind Caddy, the browser talks to `https://localhost` (port 443) and Caddy proxies to the API server. In this case, set:

```bash
export FRONTEND_URL=https://localhost
```

---

## 5. Rate limited (429 responses)

**Symptoms:** API calls return `429 Too Many Requests`.

**Check Redis:**

Rate limiting uses Redis sliding windows. If Redis is down, the rate limiter may reject all requests as a safety default.

```bash
docker compose ps redis
docker compose exec redis redis-cli ping
```

You should see `PONG`. If not, restart Redis:

```bash
docker compose restart redis
```

**Increase rate limits:**

The default limits are appropriate for development but may be too low for load testing. Override them with environment variables:

```bash
export RATE_LIMIT_RPS=100      # requests per second per API key
export RATE_LIMIT_BURST=200    # burst allowance
```

Restart the API server after changing these values.

**SDK batch size:**

If you are hitting rate limits during ingestion, increase the SDK batch size to send fewer, larger requests:

```python
agentstack.init(
    api_key="as_sk_...",
    batch_size=200,         # default is 50
    flush_interval=10.0,    # default is 5 seconds
)
```

---

## 6. Port conflicts

**Symptoms:** `docker compose up` or `make dev` fails because a port is already in use.

### Default ports

| Service | Port |
|---------|------|
| Next.js dashboard | 3000 |
| PostgreSQL | 5436 (mapped from 5432 inside the container) |
| ClickHouse native | 9000 |
| ClickHouse HTTP | 8123 |
| Redis | 6379 |
| NATS | 4222 |
| NATS monitoring | 8222 |
| API server | 8080 |
| Gateway proxy | 8090 |

### Find what is using a port

```bash
lsof -i :3000
```

### Common conflicts

- **Port 3000** — Open WebUI, other Node.js apps, or a previous Next.js instance. Kill the process or change the Next.js port:

  ```bash
  cd web && PORT=3001 npm run dev
  ```

  Then update `FRONTEND_URL=http://localhost:3001`.

- **Port 5432** — A local PostgreSQL installation. The docker-compose maps the container port to `5436` to avoid this conflict. Make sure `DATABASE_URL` uses port `5436`.

- **Port 9000** — Some applications (like PHP-FPM or Portainer) use 9000. Stop the conflicting service or remap ClickHouse in `docker-compose.override.yml`:

  ```yaml
  services:
    clickhouse:
      ports: ["9001:9000", "8124:8123"]
  ```

  Then update `CLICKHOUSE_URL=clickhouse://localhost:9001/agentstack`.

---

## 7. Migration failures

**Symptoms:** `make migrate` exits with an error.

### "relation already exists"

This means the migration was partially applied. Check the migration state:

```bash
docker compose exec postgres psql -U agentstack -c \
  "SELECT * FROM schema_migrations ORDER BY version;"
```

If the latest migration shows `dirty = true`, fix it manually:

```bash
# Reset the dirty flag (replace VERSION with the failing migration number)
docker compose exec postgres psql -U agentstack -c \
  "UPDATE schema_migrations SET dirty = false WHERE version = VERSION;"
```

Then re-run `make migrate`.

### "database does not exist"

```bash
docker compose exec postgres psql -U agentstack -c "CREATE DATABASE agentstack;"
```

### Start fresh

If migrations are beyond repair in development, reset everything:

```bash
make docker-reset   # drops all volumes and recreates containers
make migrate
make seed
```

This destroys all data. Only use it in development.

---

## 8. JWT expired or invalid

**Symptoms:** Dashboard shows a login screen or API calls return `401 Unauthorized` with `token expired`.

### Regenerate via the login flow

Log out and log back in via GitHub OAuth at `/auth/github`. This issues a fresh JWT.

### Check the JWT secret

If the `JWT_SECRET` changed between server restarts, all existing tokens become invalid. Make sure the secret is consistent. In development, the default is `dev-secret-change-in-production`.

### Decode a token for debugging

Use a tool like [jwt.io](https://jwt.io) or the command line:

```bash
# Decode the payload (middle section) of a JWT
echo "YOUR_JWT_TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

Check the `exp` field — it is a Unix timestamp. Compare it to the current time:

```bash
date +%s
```

### API keys do not expire

If you need stable authentication for scripts and CI/CD, use API keys instead of JWTs. API keys have no expiration and can be revoked individually from Settings > API Keys.

---

## Still stuck?

1. Check the API server logs in the terminal where `make dev` is running.
2. Check the browser developer console (F12 > Console) for JavaScript errors.
3. Check the Docker service logs: `docker compose logs <service-name> --tail 100`.
4. Open an issue at [github.com/agentstack/agentstack/issues](https://github.com/agentstack/agentstack/issues) with the error message and steps to reproduce.

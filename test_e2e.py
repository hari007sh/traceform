#!/usr/bin/env python3
"""
AgentStack End-to-End Integration Tests

Validates the full stack: API endpoints, gateway proxy, SDK integration,
and data flow through PostgreSQL, ClickHouse, Redis, and NATS.

Prerequisites:
  - Docker services running (make docker-up)
  - API server on :8080 (make dev)
  - Gateway on :8090 (make gateway)
  - Workers running (make worker)

Usage:
  python3 test_e2e.py
"""

import json
import os
import sys
import time
import uuid
import urllib.request
import urllib.error

BASE_URL = os.environ.get("AGENTSTACK_URL", "http://localhost:8080")
GATEWAY_URL = os.environ.get("AGENTSTACK_GATEWAY_URL", "http://localhost:8090")
API_KEY = "as_sk_test123"
ORG_ID = "00000000-0000-0000-0000-000000000001"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

passed = 0
failed = 0
errors = []


def api(method, path, body=None, base=None):
    """Make an API request and return parsed JSON."""
    url = (base or BASE_URL) + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode() if e.fp else ""
        return {"_error": True, "_status": e.code, "_body": body_text}
    except Exception as e:
        return {"_error": True, "_status": 0, "_body": str(e)}


def check(name, condition, detail=""):
    """Record a test result."""
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        msg = f"  FAIL  {name}" + (f" -- {detail}" if detail else "")
        print(msg)
        errors.append(msg)


def test_health():
    print("\n--- Health Checks ---")
    data = api("GET", "/health")
    check("API server healthy", data.get("status") == "healthy")

    gw = api("GET", "/health", base=GATEWAY_URL)
    check("Gateway healthy", gw.get("status") == "healthy")


def test_sessions():
    print("\n--- Sessions API ---")
    data = api("GET", "/v1/sessions")
    sessions = data.get("sessions", [])
    check("Sessions list returns data", len(sessions) > 0, f"got {len(sessions)}")

    if sessions:
        sid = sessions[0]["id"]
        detail = api("GET", f"/v1/sessions/{sid}")
        # Session detail may be nested under "session" key or flat
        session_data = detail.get("session", detail)
        check("Session detail returns session",
              session_data.get("id") == sid,
              f"got keys: {list(detail.keys())[:5]}")


def test_analytics():
    print("\n--- Analytics API ---")
    data = api("GET", "/v1/analytics/overview")
    check("Overview has total_sessions", "total_sessions" in data)
    check("Overview has reliability_score", "reliability_score" in data)
    check("Reliability score is valid", 0 <= data.get("reliability_score", -1) <= 1)

    sot = api("GET", "/v1/analytics/sessions-over-time?period=7d")
    check("Sessions-over-time returns data", isinstance(sot, (list, dict)))

    fr = api("GET", "/v1/analytics/failure-rate?period=7d")
    check("Failure-rate returns data", isinstance(fr, (list, dict)))


def test_guard():
    print("\n--- Guard API ---")
    events = api("GET", "/v1/guard/events")
    check("Guard events list works", not events.get("_error"))

    check_result = api("POST", "/v1/guard/check", {
        "content": "Hello, how are you?",
        "direction": "input",
    })
    check("Guard check endpoint works", not check_result.get("_error"),
          check_result.get("_body", "") if check_result.get("_error") else "")


def test_cost():
    print("\n--- Cost API ---")
    summary = api("GET", "/v1/cost/analytics/summary")
    check("Cost summary has total_spend", "total_spend_cents" in summary)
    check("Cost summary has unique_models", "unique_models" in summary)

    by_model = api("GET", "/v1/cost/analytics/by-model")
    check("Cost by-model returns data", isinstance(by_model, (list, dict)))

    budgets = api("GET", "/v1/cost/budgets")
    check("Budgets list works", not budgets.get("_error"))


def test_test_module():
    print("\n--- Test Module API ---")
    suites = api("GET", "/v1/test/suites")
    suite_list = suites.get("suites", [])
    check("Test suites list works", not suites.get("_error"))
    check("Has pre-seeded suites", len(suite_list) > 0, f"got {len(suite_list)}")

    evaluators = api("GET", "/v1/test/evaluators")
    check("Evaluators list works", not evaluators.get("_error"))


def test_providers():
    print("\n--- Providers & Routes API ---")
    providers = api("GET", "/v1/gateway/providers")
    check("Providers list works", isinstance(providers, list))
    check("Has at least 1 provider", len(providers) > 0)

    routes = api("GET", "/v1/gateway/routes")
    check("Routes list works", isinstance(routes, list))


def test_prompts():
    print("\n--- Prompts API ---")
    prompts = api("GET", "/v1/prompts")
    check("Prompts list works", not (isinstance(prompts, dict) and prompts.get("_error")))


def test_datasets():
    print("\n--- Datasets API ---")
    datasets = api("GET", "/v1/datasets")
    check("Datasets list works", not (isinstance(datasets, dict) and datasets.get("_error")))


def test_webhooks():
    print("\n--- Webhooks API ---")
    webhooks = api("GET", "/v1/webhooks")
    # Webhooks might return empty list or error if no webhooks configured
    is_ok = isinstance(webhooks, list) or (isinstance(webhooks, dict) and not webhooks.get("_error"))
    check("Webhooks list works", is_ok,
          webhooks.get("_body", "")[:100] if isinstance(webhooks, dict) and webhooks.get("_error") else "")


def test_ingest():
    print("\n--- Ingest Pipeline (SDK -> API -> NATS -> ClickHouse) ---")
    session_id = str(uuid.uuid4())
    agent_name = "e2e-test-agent"

    result = api("POST", "/v1/ingest/sessions", {
        "id": session_id,
        "agent_name": agent_name,
        "status": "completed",
        "metadata": "{}",
        "total_tokens": 100,
        "total_cost_cents": 5,
        "duration_ms": 500,
    })
    check("Session ingest accepted", not result.get("_error"),
          result.get("_body", "") if result.get("_error") else "")

    span_id = str(uuid.uuid4())
    span_result = api("POST", "/v1/ingest/spans", [{
        "id": span_id,
        "session_id": session_id,
        "name": "e2e-test-span",
        "span_type": "llm_call",
        "model": "test-model",
        "input": "test input",
        "output": "test output",
        "input_tokens": 50,
        "output_tokens": 50,
        "total_tokens": 100,
        "cost_cents": 5,
        "duration_ms": 500,
        "status": "completed",
    }])
    check("Span ingest accepted", not span_result.get("_error"),
          span_result.get("_body", "") if span_result.get("_error") else "")

    # Wait for NATS -> ClickHouse pipeline with retry (batch flush interval is 2s)
    found = False
    for attempt in range(4):
        time.sleep(3)
        detail = api("GET", f"/v1/sessions/{session_id}")
        session_data = detail.get("session", detail)
        if session_data.get("id") == session_id:
            found = True
            break
    check("Ingested session is queryable", found,
          f"session not found after 12s: {session_id}")


def test_gateway_proxy():
    print("\n--- Gateway Proxy (LMStudio Integration) ---")
    try:
        req = urllib.request.Request("http://localhost:1234/v1/models")
        with urllib.request.urlopen(req, timeout=5) as resp:
            models = json.loads(resp.read().decode())
            lmstudio_available = len(models.get("data", [])) > 0
    except Exception:
        lmstudio_available = False

    if not lmstudio_available:
        print("  SKIP  LMStudio not available, skipping gateway proxy tests")
        return

    check("LMStudio is running", True)

    gw_headers = {**HEADERS, "X-AgentStack-Org-ID": ORG_ID}
    req_body = json.dumps({
        "model": "qwen3-30b-a3b-instruct-2507-mlx",
        "messages": [{"role": "user", "content": "Say 'ok' and nothing else."}],
        "max_tokens": 10,
    }).encode()

    req = urllib.request.Request(
        f"{GATEWAY_URL}/v1/chat/completions",
        data=req_body, headers=gw_headers, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
            has_choices = len(data.get("choices", [])) > 0
            has_content = bool(data.get("choices", [{}])[0].get("message", {}).get("content", ""))
            check("Gateway returns chat completion", has_choices and has_content)
            check("Gateway response has usage stats", "usage" in data)
    except Exception as e:
        check("Gateway chat completion", False, str(e))


def test_cost_event_recording():
    print("\n--- Cost Event Recording ---")
    result = api("POST", "/v1/cost/events", {
        "session_id": str(uuid.uuid4()),
        "agent_name": "e2e-cost-test",
        "model": "test-model",
        "provider": "test-provider",
        "input_tokens": 100,
        "output_tokens": 50,
        "cost_cents": 3,
    })
    check("Cost event recorded", not result.get("_error"),
          result.get("_body", "") if result.get("_error") else "")


def test_healing():
    print("\n--- Healing (Shield) API ---")
    events = api("GET", "/v1/analytics/healing")
    check("Healing analytics works", not events.get("_error"))


def test_auth_rejection():
    print("\n--- Auth Rejection ---")
    bad_req = urllib.request.Request(
        f"{BASE_URL}/v1/sessions",
        headers={"Authorization": "Bearer bad_key", "Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(bad_req, timeout=5)
        check("Bad API key rejected", False, "request should have been rejected")
    except urllib.error.HTTPError as e:
        check("Bad API key rejected", e.code == 401, f"status={e.code}")


def test_server_side_pagination():
    print("\n--- Server-Side Pagination ---")
    # Test page 1 with per_page=10
    p1 = api("GET", "/v1/sessions?page=1&per_page=10")
    check("Page 1 returns limited results", len(p1.get("sessions", [])) <= 10)
    check("Page 1 has meta", "meta" in p1, str(p1.keys()))
    meta = p1.get("meta", {})
    check("Meta has total_pages", "total_pages" in meta)
    check("Meta page is 1", meta.get("page") == 1)

    # Test page 2
    p2 = api("GET", "/v1/sessions?page=2&per_page=10")
    check("Page 2 returns results", len(p2.get("sessions", [])) > 0)
    check("Page 2 different from page 1",
          p2.get("sessions", [{}])[0].get("id") != p1.get("sessions", [{}])[0].get("id"))


def test_server_side_search():
    print("\n--- Server-Side Search ---")
    results = api("GET", "/v1/sessions?search=truncation-test")
    sessions = results.get("sessions", [])
    check("Search returns results", len(sessions) > 0)
    if sessions:
        check("Search results match query",
              all("truncation" in s.get("agent_name", "").lower() or
                  "truncation" in s.get("id", "").lower() for s in sessions))


def test_server_side_filter():
    print("\n--- Server-Side Status Filter ---")
    results = api("GET", "/v1/sessions?status=completed&per_page=10")
    sessions = results.get("sessions", [])
    check("Filter returns results", len(sessions) > 0)
    if sessions:
        check("All results match status filter",
              all(s.get("status") == "completed" for s in sessions))


def test_time_range_filtering():
    print("\n--- Time Range Filtering ---")
    import datetime
    now = datetime.datetime.utcnow()
    start = (now - datetime.timedelta(days=1)).isoformat() + "Z"
    end = now.isoformat() + "Z"

    results = api("GET", f"/v1/sessions?start={start}&end={end}&per_page=5")
    check("Time range query works", not results.get("_error"),
          results.get("_body", "")[:100] if results.get("_error") else "")


def test_body_size_limit():
    print("\n--- Body Size Limit ---")
    # Send a request larger than 10MB — should get 413
    huge_payload = {"id": "test", "agent_name": "test", "metadata": "x" * (11 * 1024 * 1024)}
    result = api("POST", "/v1/ingest/sessions", huge_payload)
    check("Oversized body rejected", result.get("_status") in [400, 413, 500],
          f"status={result.get('_status')}")


def test_circuit_breaker_exists():
    print("\n--- Circuit Breaker (Smoke Test) ---")
    # Just verify the gateway responds to non-existent model without crashing
    gw_headers = {**HEADERS, "X-AgentStack-Org-ID": ORG_ID}
    result = api("POST", "/v1/chat/completions", {
        "model": "nonexistent-model-xyz",
        "messages": [{"role": "user", "content": "test"}],
        "max_tokens": 5,
    }, base=GATEWAY_URL)
    # Should get an error, not a crash
    check("Gateway handles unknown model gracefully",
          result.get("_error") or "error" in str(result).lower(),
          "Expected error response for nonexistent model")


def test_rate_limiting():
    print("\n--- Rate Limiting ---")
    # Just verify the rate limit header or response
    result = api("GET", "/v1/sessions?per_page=1")
    check("Rate limited endpoint accessible", not result.get("_error"))


def test_usage_endpoint():
    print("\n--- Usage Endpoint ---")
    # Need JWT token for /api routes
    result = api("GET", "/api/usage")
    # May get 401 since we use API key not JWT, that's ok
    check("Usage endpoint exists", result.get("_status") in [200, 401, 403])


def test_error_groups():
    print("\n--- Error Groups ---")
    result = api("GET", "/v1/errors")
    check("Error groups endpoint works", not result.get("_error"),
          result.get("_body", "")[:100] if result.get("_error") else "")


def test_logout_endpoint():
    print("\n--- Logout ---")
    result = api("POST", "/auth/logout")
    # Will get 401 since we use API key, but endpoint should exist (not 404)
    check("Logout endpoint exists", result.get("_status") != 404)


def test_key_rotation():
    print("\n--- API Key Rotation ---")
    # Just verify the endpoint pattern exists (don't actually rotate the test key)
    result = api("POST", "/api/api-keys/nonexistent/rotate")
    check("Rotation endpoint exists", result.get("_status") in [401, 403, 404])


def test_clickhouse_indexes_exist():
    print("\n--- ClickHouse Skip Indexes ---")
    import subprocess
    result = subprocess.run(
        ["docker", "exec", "agentstack-fresh-clickhouse-1", "clickhouse-client",
         "--query", "SELECT name FROM system.data_skipping_indices WHERE table = 'sessions' AND database = 'agentstack'"],
        capture_output=True, text=True, timeout=10
    )
    indexes = result.stdout.strip().split('\n') if result.stdout.strip() else []
    check("Sessions table has skip indexes", len(indexes) >= 2, f"found: {indexes}")


def main():
    print("=" * 60)
    print("AgentStack E2E Integration Tests")
    print("=" * 60)
    print(f"API:     {BASE_URL}")
    print(f"Gateway: {GATEWAY_URL}")
    print(f"API Key: {API_KEY[:15]}...")

    test_health()
    test_sessions()
    test_analytics()
    test_guard()
    test_cost()
    test_test_module()
    test_providers()
    test_prompts()
    test_datasets()
    test_webhooks()
    test_ingest()
    test_gateway_proxy()
    test_cost_event_recording()
    test_healing()
    test_auth_rejection()

    # Launch readiness tests
    test_usage_endpoint()
    test_error_groups()
    test_logout_endpoint()
    test_key_rotation()

    # Enterprise hardening tests
    test_server_side_pagination()
    test_server_side_search()
    test_server_side_filter()
    test_time_range_filtering()
    test_body_size_limit()
    test_circuit_breaker_exists()
    test_rate_limiting()
    test_clickhouse_indexes_exist()

    print("\n" + "=" * 60)
    total = passed + failed
    print(f"Results: {passed}/{total} passed, {failed} failed")
    if errors:
        print("\nFailures:")
        for e in errors:
            print(e)
    print("=" * 60)
    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
E2E Verification Script for Enterprise-Scale Optimizations

Tests all 4 optimization features:
1. Materialized Views — verify MV populated after session ingestion
2. Payload Truncation — verify large payloads are truncated in ClickHouse
3. Payload Fetch — verify full payload retrieval from blob storage
4. Sampling Config API — verify CRUD operations
5. MV Analytics — verify analytics endpoint returns MV-backed data
"""

import json
import os
import sys
import time
import uuid

import requests

API_URL = "http://localhost:8080"
CH_URL = "http://localhost:8123"

# Read JWT token
_jwt_file = "/tmp/traceform_jwt.txt"
if os.path.exists(_jwt_file):
    with open(_jwt_file) as f:
        TOKEN = f.read().strip()
else:
    print("ERROR: JWT token not found at /tmp/traceform_jwt.txt")
    sys.exit(1)

HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

passed = 0
failed = 0


def test(name, condition, detail=""):
    """Record a test result."""
    global passed, failed
    if condition:
        print(f"  PASS: {name}")
        passed += 1
    else:
        print(f"  FAIL: {name} -- {detail}")
        failed += 1


def ch_query(sql):
    """Execute a query against ClickHouse HTTP interface and return the result text."""
    try:
        r = requests.post(CH_URL, data=sql, timeout=10)
        return r.text.strip()
    except Exception as e:
        return f"ERROR: {e}"


# ============================================================
# Test 1: Materialized Views
# ============================================================
print("\n=== Test 1: Materialized Views ===")

session_id = str(uuid.uuid4())
span_id = str(uuid.uuid4())

batch_payload = {
    "sessions": [
        {
            "id": session_id,
            "agent_name": "mv-test-agent",
            "status": "completed",
            "input": "test input for MV",
            "output": "test output for MV",
            "total_tokens": 500,
            "total_cost_cents": 10,
            "total_spans": 1,
            "duration_ms": 1200,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "ended_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    ],
    "spans": [
        {
            "id": span_id,
            "session_id": session_id,
            "name": "mv-test-span",
            "span_type": "llm_call",
            "status": "completed",
            "input": "short input",
            "output": "short output",
            "model": "gpt-4o",
            "provider": "openai",
            "input_tokens": 100,
            "output_tokens": 50,
            "total_tokens": 150,
            "cost_cents": 5,
            "duration_ms": 800,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "ended_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    ],
}

resp = requests.post(f"{API_URL}/v1/ingest/batch", json=batch_payload, headers=HEADERS, timeout=10)
test("Batch ingest accepted", resp.status_code == 202, f"status={resp.status_code} body={resp.text[:200]}")

# Wait for NATS -> Worker -> ClickHouse pipeline + MV population
print("  Waiting 5s for async pipeline...")
time.sleep(5)

# Verify session landed in ClickHouse
session_count = ch_query(
    f"SELECT count() FROM traceform.sessions WHERE id = '{session_id}'"
)
try:
    sc = int(session_count.split("\n")[0].strip())
    test("Session written to ClickHouse", sc >= 1, f"count={sc}")
except (ValueError, IndexError):
    test("Session written to ClickHouse", False, f"raw={session_count}")

# Verify MV populated (use countMerge on the AggregateFunction column)
mv_result = ch_query(
    "SELECT countMerge(session_count) FROM traceform.mv_sessions_hourly_data "
    "WHERE org_id != '' "
    "AND hour >= now() - INTERVAL 1 HOUR"
)
try:
    mv_count = int(mv_result)
    test("MV mv_sessions_hourly_data populated", mv_count > 0, f"countMerge={mv_count}")
except ValueError:
    test("MV mv_sessions_hourly_data populated", False, f"unexpected result: {mv_result}")

# Verify span MV populated
mv_span_result = ch_query(
    "SELECT countMerge(span_count) FROM traceform.mv_spans_hourly_data "
    "WHERE org_id != '' "
    "AND hour >= now() - INTERVAL 1 HOUR"
)
try:
    mv_span_count = int(mv_span_result)
    test("MV mv_spans_hourly_data populated", mv_span_count > 0, f"countMerge={mv_span_count}")
except ValueError:
    test("MV mv_spans_hourly_data populated", False, f"unexpected result: {mv_span_result}")

# ============================================================
# Test 2: Payload Truncation
# ============================================================
print("\n=== Test 2: Payload Truncation ===")

truncation_session_id = str(uuid.uuid4())
truncation_span_id = str(uuid.uuid4())

# Create a 10KB payload (well above the 4096 byte truncation threshold)
large_payload = "A" * 10240  # 10KB of 'A' characters

batch_truncation = {
    "sessions": [
        {
            "id": truncation_session_id,
            "agent_name": "truncation-test-agent",
            "status": "completed",
            "input": "truncation test session",
            "output": "done",
            "total_tokens": 200,
            "total_cost_cents": 5,
            "total_spans": 1,
            "duration_ms": 600,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "ended_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    ],
    "spans": [
        {
            "id": truncation_span_id,
            "session_id": truncation_session_id,
            "name": "truncation-test-span",
            "span_type": "llm_call",
            "status": "completed",
            "input": large_payload,
            "output": "small output",
            "model": "gpt-4o",
            "provider": "openai",
            "input_tokens": 2000,
            "output_tokens": 100,
            "total_tokens": 2100,
            "cost_cents": 8,
            "duration_ms": 500,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "ended_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    ],
}

resp = requests.post(f"{API_URL}/v1/ingest/batch", json=batch_truncation, headers=HEADERS, timeout=10)
test("Truncation batch ingest accepted", resp.status_code == 202, f"status={resp.status_code}")

print("  Waiting 5s for async pipeline...")
time.sleep(5)

# Query ClickHouse to verify truncation
trunc_result = ch_query(
    f"SELECT input_truncated, input_hash, length(input) "
    f"FROM traceform.spans WHERE id = '{truncation_span_id}' LIMIT 1 FORMAT TabSeparated"
)
if trunc_result and not trunc_result.startswith("ERROR"):
    # Take first line only and split by tab
    first_line = trunc_result.split("\n")[0]
    parts = first_line.split("\t")
    if len(parts) >= 3:
        input_truncated = parts[0].strip()
        input_hash = parts[1].strip()
        input_length = int(parts[2].strip())
        test("input_truncated = 1", input_truncated == "1", f"got {input_truncated}")
        test("input_hash is not empty", input_hash != "" and input_hash != "''", f"got '{input_hash}'")
        test("input length <= 4096", input_length <= 4096, f"got {input_length}")
    else:
        test("Truncation fields readable", False, f"unexpected format: {trunc_result}")
else:
    test("Truncation span found in ClickHouse", False, f"query result: {trunc_result}")

# Also verify output was NOT truncated (it's small)
out_trunc = ch_query(
    f"SELECT output_truncated FROM traceform.spans WHERE id = '{truncation_span_id}' LIMIT 1"
)
test("output_truncated = 0 (small payload)", out_trunc.split("\n")[0].strip() == "0", f"got {out_trunc}")

# ============================================================
# Test 3: Payload Fetch
# ============================================================
print("\n=== Test 3: Payload Fetch ===")

resp = requests.get(
    f"{API_URL}/v1/spans/{truncation_span_id}/payload?field=input",
    headers=HEADERS,
    timeout=10,
)
test("Payload fetch returns 200", resp.status_code == 200, f"status={resp.status_code} body={resp.text[:200]}")

if resp.status_code == 200:
    payload_data = resp.json()
    fetched_payload = payload_data.get("payload", "")
    source = payload_data.get("source", "")

    test("Payload source is 'blob'", source == "blob", f"got source='{source}'")
    test(
        "Full payload length matches original (10240)",
        len(fetched_payload) == 10240,
        f"got length={len(fetched_payload)}",
    )
    test(
        "Payload content matches original",
        fetched_payload == large_payload,
        f"first 50 chars: {fetched_payload[:50]}",
    )
else:
    test("Payload fetch response parseable", False, f"non-200: {resp.status_code}")
    test("Payload source is blob", False, "skipped")
    test("Full payload length matches", False, "skipped")

# ============================================================
# Test 4: Sampling Config API
# ============================================================
print("\n=== Test 4: Sampling Config API ===")

sampling_agent = f"sampling-test-{uuid.uuid4().hex[:8]}"

# PUT — create sampling config
put_resp = requests.put(
    f"{API_URL}/v1/settings/sampling",
    json={
        "agent_name": sampling_agent,
        "sample_rate": 0.5,
        "always_keep_errors": True,
        "always_keep_slow_ms": 5000,
    },
    headers=HEADERS,
    timeout=10,
)
test("PUT sampling config returns 200", put_resp.status_code == 200, f"status={put_resp.status_code} body={put_resp.text[:200]}")

config_id = ""
if put_resp.status_code == 200:
    config_data = put_resp.json()
    config_id = config_data.get("id", "")
    test("Config has ID", config_id != "", f"response: {json.dumps(config_data)[:200]}")
    test(
        "Config sample_rate is 0.5",
        config_data.get("sample_rate") == 0.5,
        f"got {config_data.get('sample_rate')}",
    )
    test(
        "Config agent_name matches",
        config_data.get("agent_name") == sampling_agent,
        f"got {config_data.get('agent_name')}",
    )

# GET — verify config exists in list
list_resp = requests.get(f"{API_URL}/v1/settings/sampling", headers=HEADERS, timeout=10)
test("GET sampling configs returns 200", list_resp.status_code == 200, f"status={list_resp.status_code}")

if list_resp.status_code == 200:
    configs = list_resp.json().get("configs", [])
    found = any(c.get("agent_name") == sampling_agent for c in configs)
    test("Created config appears in list", found, f"configs count={len(configs)}")

# DELETE — remove the config
if config_id:
    del_resp = requests.delete(
        f"{API_URL}/v1/settings/sampling/{config_id}",
        headers=HEADERS,
        timeout=10,
    )
    test("DELETE sampling config returns 204", del_resp.status_code == 204, f"status={del_resp.status_code}")

    # GET — verify it's gone
    list_resp2 = requests.get(f"{API_URL}/v1/settings/sampling", headers=HEADERS, timeout=10)
    if list_resp2.status_code == 200:
        configs2 = list_resp2.json().get("configs", [])
        still_there = any(c.get("agent_name") == sampling_agent for c in configs2)
        test("Deleted config is gone from list", not still_there, f"still found in {len(configs2)} configs")
    else:
        test("GET after delete returns 200", False, f"status={list_resp2.status_code}")
else:
    test("DELETE sampling config", False, "skipped — no config_id from PUT")
    test("Deleted config is gone from list", False, "skipped")

# ============================================================
# Test 5: MV Analytics
# ============================================================
print("\n=== Test 5: MV Analytics ===")

analytics_resp = requests.get(f"{API_URL}/v1/analytics/overview", headers=HEADERS, timeout=10)
test("GET /v1/analytics/overview returns 200", analytics_resp.status_code == 200, f"status={analytics_resp.status_code}")

if analytics_resp.status_code == 200:
    overview = analytics_resp.json()
    test(
        "Overview has total_sessions field",
        "total_sessions" in overview,
        f"keys: {list(overview.keys())}",
    )
    test(
        "Overview has reliability_score field",
        "reliability_score" in overview,
        f"keys: {list(overview.keys())}",
    )
    # After our ingestion, total_sessions should be > 0
    test(
        "total_sessions > 0 (MV queries work)",
        overview.get("total_sessions", 0) > 0,
        f"total_sessions={overview.get('total_sessions')}",
    )
else:
    test("Overview response parseable", False, "skipped")
    test("Overview has total_sessions field", False, "skipped")
    test("total_sessions > 0", False, "skipped")

# Also test sessions-over-time endpoint (MV-backed)
sot_resp = requests.get(f"{API_URL}/v1/analytics/sessions-over-time", headers=HEADERS, timeout=10)
test("GET /v1/analytics/sessions-over-time returns 200", sot_resp.status_code == 200, f"status={sot_resp.status_code}")

# ============================================================
# Results
# ============================================================
print(f"\n{'='*50}")
print(f"Results: {passed} passed, {failed} failed out of {passed + failed} tests")
print(f"{'='*50}")
sys.exit(0 if failed == 0 else 1)

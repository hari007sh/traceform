#!/usr/bin/env python3
"""
AgentStack — Real Agent Simulation with LM Studio

Creates realistic AI agent scenarios that make REAL LLM calls to a local
LM Studio instance and traces everything through AgentStack.

Agents:
  1. Customer Support Agent   — answers support tickets with RAG
  2. Code Review Agent        — reviews code snippets, finds bugs
  3. Research Agent            — multi-step web research + summarization
  4. Data Analysis Agent       — SQL generation + data interpretation
  5. Content Writing Agent     — blog post / marketing copy generation
  6. Email Draft Agent         — professional email composition
  7. Meeting Summary Agent     — extracts action items from transcripts
  8. DevOps Incident Agent     — diagnoses production incidents

Each agent runs multiple sessions with varied inputs, tracks spans
(llm_call, tool_call, retrieval, chain), and reports real token usage.
Some sessions intentionally fail to generate error data.
"""

import json
import os
import random
import sys
import time
import uuid
from datetime import datetime, timezone

import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
API_URL = "http://localhost:8080"
LLM_URL = "http://localhost:1234"
LLM_MODEL = "qwen3-30b-a3b-instruct-2507-mlx"
LLM_MODEL_SMALL = "google/gemma-3-4b"

# Auth — prefer JWT over API key
_jwt_file = "/tmp/agentstack_jwt.txt"
if os.path.exists(_jwt_file):
    with open(_jwt_file) as f:
        AUTH_TOKEN = f.read().strip()
    print(f"[auth] Using JWT token")
else:
    AUTH_TOKEN = os.environ.get("AGENTSTACK_API_KEY", "as_sk_test123")
    print(f"[auth] Using API key: {AUTH_TOKEN[:20]}...")

HEADERS = {"Authorization": f"Bearer {AUTH_TOKEN}", "Content-Type": "application/json"}

# Pricing (in cents per 1K tokens) for cost tracking
MODEL_PRICING = {
    "qwen3-30b": {"input": 0.15, "output": 0.60},
    "gemma-3-4b": {"input": 0.05, "output": 0.20},
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def api_post(path, data):
    try:
        r = requests.post(f"{API_URL}{path}", json=data, headers=HEADERS, timeout=15)
        if r.status_code < 300:
            return r.json() if r.text.strip() else {}
        print(f"  [warn] {path} → {r.status_code}: {r.text[:120]}")
        return None
    except Exception as e:
        print(f"  [err] {path}: {e}")
        return None


def llm_call(messages, model=None, max_tokens=512, temperature=0.7):
    """Make a real LLM call to LM Studio. Returns (response_text, usage_dict)."""
    model = model or LLM_MODEL
    try:
        r = requests.post(
            f"{LLM_URL}/v1/chat/completions",
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            },
            timeout=120,
        )
        data = r.json()
        text = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        return text, usage
    except Exception as e:
        print(f"  [llm-err] {e}")
        return None, {}


def calc_cost_cents(usage, model=None):
    """Calculate cost in cents from token usage."""
    model_key = "qwen3-30b" if "qwen" in (model or LLM_MODEL).lower() else "gemma-3-4b"
    pricing = MODEL_PRICING.get(model_key, {"input": 0.10, "output": 0.40})
    inp = usage.get("prompt_tokens", 0)
    out = usage.get("completion_tokens", 0)
    return max(1, int((inp * pricing["input"] + out * pricing["output"]) / 1000 * 100))


def ts_rfc3339(t=None):
    dt = datetime.fromtimestamp(t or time.time(), tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond:06d}Z"


def ingest_session(session_data, spans_data):
    """Send a complete session + spans to the batch ingest endpoint."""
    payload = {"sessions": [session_data]}
    if spans_data:
        payload["spans"] = spans_data
    return api_post("/v1/ingest/batch", payload)


def send_cost_event(session_id, agent_name, model, tokens_in, tokens_out, cost_cents):
    """Send a cost event."""
    api_post("/v1/cost/events", {
        "session_id": session_id,
        "agent_name": agent_name,
        "model": model,
        "provider": "lmstudio",
        "input_tokens": tokens_in,
        "output_tokens": tokens_out,
        "total_tokens": tokens_in + tokens_out,
        "cost_cents": cost_cents,
        "metadata": json.dumps({"source": "real_agent_simulation"}),
    })


def send_guard_check(input_text, rules=None):
    """Run a guard check on input text."""
    return api_post("/v1/guard/check", {
        "input": input_text,
        "rules": rules or ["pii", "injection"],
    })


# ---------------------------------------------------------------------------
# Agent Scenarios
# ---------------------------------------------------------------------------

def run_customer_support_agent():
    """Customer Support Agent — answers tickets using RAG + LLM."""
    print("\n🎧 Customer Support Agent")
    tickets = [
        {"customer": "Alice", "issue": "I can't log into my account after the password reset. I keep getting 'invalid credentials' error."},
        {"customer": "Bob", "issue": "My subscription was charged twice this month. Order #ORD-29481. Please refund the duplicate."},
        {"customer": "Carol", "issue": "The API rate limit seems too low for our enterprise plan. We're hitting 429 errors constantly."},
        {"customer": "Dave", "issue": "Your mobile app crashes every time I try to upload a file larger than 10MB on Android 14."},
        {"customer": "Eve", "issue": "I need to export all my data before canceling. What format will the export be in?"},
    ]

    for ticket in tickets:
        sid = str(uuid.uuid4())
        t0 = time.time()
        spans = []
        total_in, total_out, total_cost = 0, 0, 0

        print(f"  → Ticket from {ticket['customer']}: {ticket['issue'][:60]}...")

        # Span 1: RAG retrieval (simulated)
        s1_start = time.time()
        time.sleep(random.uniform(0.05, 0.15))  # simulate retrieval latency
        s1_end = time.time()
        context_docs = f"KB Article: Account Recovery - To resolve login issues after password reset, clear browser cache and try incognito mode. If the issue persists, check if 2FA is enabled."
        spans.append({
            "id": str(uuid.uuid4()), "session_id": sid,
            "name": "knowledge-base-search", "span_type": "retrieval",
            "status": "completed",
            "input": json.dumps({"query": ticket["issue"][:100]}),
            "output": json.dumps({"docs_found": 3, "top_relevance": 0.89}),
            "model": "", "provider": "",
            "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
            "cost_cents": 0,
            "duration_ms": int((s1_end - s1_start) * 1000),
            "metadata": json.dumps({"retriever": "vector_search", "top_k": 5}),
            "started_at": ts_rfc3339(s1_start), "ended_at": ts_rfc3339(s1_end),
        })

        # Span 2: LLM call to generate response
        s2_start = time.time()
        messages = [
            {"role": "system", "content": "You are a helpful customer support agent. Use the provided context to answer the customer's question. Be concise, empathetic, and professional. Keep response under 150 words."},
            {"role": "user", "content": f"Customer: {ticket['customer']}\nIssue: {ticket['issue']}\n\nContext:\n{context_docs}\n\nProvide a helpful response:"},
        ]
        response, usage = llm_call(messages, max_tokens=300)
        s2_end = time.time()

        if response:
            cost = calc_cost_cents(usage)
            total_in += usage.get("prompt_tokens", 0)
            total_out += usage.get("completion_tokens", 0)
            total_cost += cost
            spans.append({
                "id": str(uuid.uuid4()), "session_id": sid,
                "name": "generate-support-response", "span_type": "llm_call",
                "status": "completed",
                "input": json.dumps({"messages": messages}),
                "output": json.dumps({"response": response[:500]}),
                "model": LLM_MODEL, "provider": "lmstudio",
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "cost_cents": cost,
                "duration_ms": int((s2_end - s2_start) * 1000),
                "metadata": json.dumps({"temperature": 0.7}),
                "started_at": ts_rfc3339(s2_start), "ended_at": ts_rfc3339(s2_end),
            })
            print(f"    ✓ Response: {response[:80]}...")
        else:
            spans.append({
                "id": str(uuid.uuid4()), "session_id": sid,
                "name": "generate-support-response", "span_type": "llm_call",
                "status": "failed", "error": "LLM call timed out",
                "input": json.dumps({"messages": messages}), "output": "{}",
                "model": LLM_MODEL, "provider": "lmstudio",
                "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
                "cost_cents": 0,
                "duration_ms": int((s2_end - s2_start) * 1000),
                "metadata": "{}", "started_at": ts_rfc3339(s2_start), "ended_at": ts_rfc3339(s2_end),
            })

        t1 = time.time()
        status = "completed" if response else "failed"
        session = {
            "id": sid, "agent_name": "Customer Support Agent",
            "status": status, "metadata": json.dumps({"customer": ticket["customer"], "channel": "web"}),
            "tags": ["support", "production"],
            "duration_ms": int((t1 - t0) * 1000),
            "total_tokens": total_in + total_out, "total_cost_cents": total_cost,
            "total_spans": len(spans),
            "started_at": ts_rfc3339(t0), "ended_at": ts_rfc3339(t1),
            "error": "" if response else "LLM call failed",
        }
        ingest_session(session, spans)
        if total_cost > 0:
            send_cost_event(sid, "Customer Support Agent", LLM_MODEL, total_in, total_out, total_cost)


def run_code_review_agent():
    """Code Review Agent — reviews code snippets and finds bugs."""
    print("\n🔍 Code Review Agent")
    snippets = [
        {"lang": "python", "code": "def get_user(id):\n    query = f'SELECT * FROM users WHERE id = {id}'\n    return db.execute(query)", "file": "api/users.py"},
        {"lang": "javascript", "code": "app.get('/admin', (req, res) => {\n  if (req.query.admin === 'true') {\n    res.json(getAllUsers());\n  }\n})", "file": "routes/admin.js"},
        {"lang": "go", "code": "func handler(w http.ResponseWriter, r *http.Request) {\n    password := r.URL.Query().Get(\"password\")\n    log.Printf(\"Login attempt with password: %s\", password)\n}", "file": "handlers/auth.go"},
    ]

    for snippet in snippets:
        sid = str(uuid.uuid4())
        t0 = time.time()
        spans = []
        total_in, total_out, total_cost = 0, 0, 0

        print(f"  → Reviewing {snippet['file']}...")

        # Span 1: Static analysis (simulated tool call)
        s1_start = time.time()
        time.sleep(random.uniform(0.02, 0.08))
        s1_end = time.time()
        spans.append({
            "id": str(uuid.uuid4()), "session_id": sid,
            "name": "static-analysis", "span_type": "tool_call",
            "status": "completed",
            "input": json.dumps({"file": snippet["file"], "lang": snippet["lang"]}),
            "output": json.dumps({"warnings": random.randint(1, 5), "errors": random.randint(0, 2)}),
            "model": "", "provider": "",
            "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
            "cost_cents": 0,
            "duration_ms": int((s1_end - s1_start) * 1000),
            "metadata": json.dumps({"tool": "semgrep"}),
            "started_at": ts_rfc3339(s1_start), "ended_at": ts_rfc3339(s1_end),
        })

        # Span 2: LLM review
        s2_start = time.time()
        messages = [
            {"role": "system", "content": "You are a senior code reviewer. Analyze this code for security vulnerabilities, bugs, and best practice violations. List issues as bullet points. Be concise — max 200 words."},
            {"role": "user", "content": f"Language: {snippet['lang']}\nFile: {snippet['file']}\n\n```{snippet['lang']}\n{snippet['code']}\n```\n\nReview this code:"},
        ]
        response, usage = llm_call(messages, max_tokens=400)
        s2_end = time.time()

        if response:
            cost = calc_cost_cents(usage)
            total_in += usage.get("prompt_tokens", 0)
            total_out += usage.get("completion_tokens", 0)
            total_cost += cost
            spans.append({
                "id": str(uuid.uuid4()), "session_id": sid,
                "name": "llm-code-review", "span_type": "llm_call",
                "status": "completed",
                "input": json.dumps({"file": snippet["file"]}),
                "output": json.dumps({"review": response[:500]}),
                "model": LLM_MODEL, "provider": "lmstudio",
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "cost_cents": cost,
                "duration_ms": int((s2_end - s2_start) * 1000),
                "metadata": json.dumps({"severity_check": True}),
                "started_at": ts_rfc3339(s2_start), "ended_at": ts_rfc3339(s2_end),
            })
            print(f"    ✓ Found issues: {response[:80]}...")

        t1 = time.time()
        session = {
            "id": sid, "agent_name": "Code Review Agent",
            "status": "completed" if response else "failed",
            "metadata": json.dumps({"file": snippet["file"], "language": snippet["lang"]}),
            "tags": ["code-review", "security"],
            "duration_ms": int((t1 - t0) * 1000),
            "total_tokens": total_in + total_out, "total_cost_cents": total_cost,
            "total_spans": len(spans),
            "started_at": ts_rfc3339(t0), "ended_at": ts_rfc3339(t1),
            "error": "" if response else "Review failed",
        }
        ingest_session(session, spans)
        if total_cost > 0:
            send_cost_event(sid, "Code Review Agent", LLM_MODEL, total_in, total_out, total_cost)


def run_research_agent():
    """Research Agent — multi-step research with search + synthesis."""
    print("\n📚 Research Agent")
    topics = [
        "What are the latest advances in AI agent frameworks in 2025?",
        "Compare Kubernetes vs serverless for AI workloads at scale",
        "What security risks exist with LLM-powered code generation tools?",
    ]

    for topic in topics:
        sid = str(uuid.uuid4())
        t0 = time.time()
        spans = []
        total_in, total_out, total_cost = 0, 0, 0

        print(f"  → Researching: {topic[:60]}...")

        # Span 1: Search (simulated tool call)
        s1_start = time.time()
        time.sleep(random.uniform(0.1, 0.3))
        s1_end = time.time()
        spans.append({
            "id": str(uuid.uuid4()), "session_id": sid,
            "name": "web-search", "span_type": "tool_call",
            "status": "completed",
            "input": json.dumps({"query": topic}),
            "output": json.dumps({"results": random.randint(8, 15), "sources": ["arxiv", "github", "blog"]}),
            "model": "", "provider": "",
            "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
            "cost_cents": 0,
            "duration_ms": int((s1_end - s1_start) * 1000),
            "metadata": json.dumps({"search_engine": "tavily"}),
            "started_at": ts_rfc3339(s1_start), "ended_at": ts_rfc3339(s1_end),
        })

        # Span 2: LLM synthesis — first pass
        s2_start = time.time()
        messages = [
            {"role": "system", "content": "You are a research analyst. Provide a thorough analysis of the topic. Include key findings, comparisons, and recommendations. Keep under 250 words."},
            {"role": "user", "content": f"Research topic: {topic}\n\nBased on recent sources, provide a comprehensive analysis:"},
        ]
        response1, usage1 = llm_call(messages, max_tokens=500)
        s2_end = time.time()

        if response1:
            cost = calc_cost_cents(usage1)
            total_in += usage1.get("prompt_tokens", 0)
            total_out += usage1.get("completion_tokens", 0)
            total_cost += cost
            spans.append({
                "id": str(uuid.uuid4()), "session_id": sid,
                "name": "initial-analysis", "span_type": "llm_call",
                "status": "completed",
                "input": json.dumps({"topic": topic}),
                "output": json.dumps({"analysis": response1[:500]}),
                "model": LLM_MODEL, "provider": "lmstudio",
                "input_tokens": usage1.get("prompt_tokens", 0),
                "output_tokens": usage1.get("completion_tokens", 0),
                "total_tokens": usage1.get("total_tokens", 0),
                "cost_cents": cost,
                "duration_ms": int((s2_end - s2_start) * 1000),
                "metadata": "{}",
                "started_at": ts_rfc3339(s2_start), "ended_at": ts_rfc3339(s2_end),
            })

            # Span 3: Follow-up — executive summary using smaller model
            s3_start = time.time()
            messages2 = [
                {"role": "system", "content": "Condense the following research into a 3-bullet executive summary. Each bullet should be one sentence."},
                {"role": "user", "content": response1},
            ]
            response2, usage2 = llm_call(messages2, model=LLM_MODEL_SMALL, max_tokens=200)
            s3_end = time.time()

            if response2:
                cost2 = calc_cost_cents(usage2, LLM_MODEL_SMALL)
                total_in += usage2.get("prompt_tokens", 0)
                total_out += usage2.get("completion_tokens", 0)
                total_cost += cost2
                spans.append({
                    "id": str(uuid.uuid4()), "session_id": sid,
                    "name": "executive-summary", "span_type": "llm_call",
                    "status": "completed",
                    "input": json.dumps({"task": "summarize"}),
                    "output": json.dumps({"summary": response2[:300]}),
                    "model": LLM_MODEL_SMALL, "provider": "lmstudio",
                    "input_tokens": usage2.get("prompt_tokens", 0),
                    "output_tokens": usage2.get("completion_tokens", 0),
                    "total_tokens": usage2.get("total_tokens", 0),
                    "cost_cents": cost2,
                    "duration_ms": int((s3_end - s3_start) * 1000),
                    "metadata": "{}",
                    "started_at": ts_rfc3339(s3_start), "ended_at": ts_rfc3339(s3_end),
                })
                print(f"    ✓ Summary: {response2[:80]}...")

        t1 = time.time()
        session = {
            "id": sid, "agent_name": "Research Agent",
            "status": "completed" if response1 else "failed",
            "metadata": json.dumps({"topic": topic, "depth": "comprehensive"}),
            "tags": ["research", "multi-step"],
            "duration_ms": int((t1 - t0) * 1000),
            "total_tokens": total_in + total_out, "total_cost_cents": total_cost,
            "total_spans": len(spans),
            "started_at": ts_rfc3339(t0), "ended_at": ts_rfc3339(t1),
            "error": "" if response1 else "Research failed",
        }
        ingest_session(session, spans)
        if total_cost > 0:
            send_cost_event(sid, "Research Agent", LLM_MODEL, total_in, total_out, total_cost)


def run_sql_agent():
    """SQL Query Agent — natural language to SQL translation."""
    print("\n🗄️  SQL Query Agent")
    queries = [
        "Show me the top 10 customers by total revenue this quarter",
        "Find all orders that were shipped late in the last 30 days",
        "What's the average response time per support agent this week?",
        "List products with inventory below reorder threshold",
    ]

    for query in queries:
        sid = str(uuid.uuid4())
        t0 = time.time()
        spans = []
        total_in, total_out, total_cost = 0, 0, 0

        print(f"  → Query: {query[:60]}...")

        # Span 1: Schema lookup (tool call)
        s1_start = time.time()
        time.sleep(random.uniform(0.02, 0.06))
        s1_end = time.time()
        spans.append({
            "id": str(uuid.uuid4()), "session_id": sid,
            "name": "schema-lookup", "span_type": "tool_call",
            "status": "completed",
            "input": json.dumps({"query": query}),
            "output": json.dumps({"tables": ["customers", "orders", "products"], "columns": 42}),
            "model": "", "provider": "",
            "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
            "cost_cents": 0,
            "duration_ms": int((s1_end - s1_start) * 1000),
            "metadata": json.dumps({"database": "postgres", "schema": "public"}),
            "started_at": ts_rfc3339(s1_start), "ended_at": ts_rfc3339(s1_end),
        })

        # Span 2: LLM generates SQL
        s2_start = time.time()
        messages = [
            {"role": "system", "content": "You are a SQL expert. Convert the natural language query to a valid PostgreSQL query. Return ONLY the SQL — no explanation. Use proper joins, aggregations, and date functions."},
            {"role": "user", "content": f"Tables: customers(id, name, email, created_at), orders(id, customer_id, total_cents, status, shipped_at, created_at), products(id, name, inventory, reorder_threshold, price_cents)\n\nQuery: {query}"},
        ]
        response, usage = llm_call(messages, max_tokens=300, temperature=0.2)
        s2_end = time.time()

        if response:
            cost = calc_cost_cents(usage)
            total_in += usage.get("prompt_tokens", 0)
            total_out += usage.get("completion_tokens", 0)
            total_cost += cost
            spans.append({
                "id": str(uuid.uuid4()), "session_id": sid,
                "name": "generate-sql", "span_type": "llm_call",
                "status": "completed",
                "input": json.dumps({"nl_query": query}),
                "output": json.dumps({"sql": response[:500]}),
                "model": LLM_MODEL, "provider": "lmstudio",
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "cost_cents": cost,
                "duration_ms": int((s2_end - s2_start) * 1000),
                "metadata": json.dumps({"temperature": 0.2}),
                "started_at": ts_rfc3339(s2_start), "ended_at": ts_rfc3339(s2_end),
            })

            # Span 3: Execute query (simulated)
            s3_start = time.time()
            time.sleep(random.uniform(0.05, 0.2))
            s3_end = time.time()
            spans.append({
                "id": str(uuid.uuid4()), "session_id": sid,
                "name": "execute-query", "span_type": "tool_call",
                "status": "completed",
                "input": json.dumps({"sql": response[:200]}),
                "output": json.dumps({"rows": random.randint(3, 150), "execution_time_ms": random.randint(12, 450)}),
                "model": "", "provider": "",
                "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
                "cost_cents": 0,
                "duration_ms": int((s3_end - s3_start) * 1000),
                "metadata": json.dumps({"database": "analytics_db"}),
                "started_at": ts_rfc3339(s3_start), "ended_at": ts_rfc3339(s3_end),
            })
            print(f"    ✓ SQL: {response[:80]}...")

        t1 = time.time()
        session = {
            "id": sid, "agent_name": "SQL Agent",
            "status": "completed" if response else "failed",
            "metadata": json.dumps({"query": query, "database": "analytics_db"}),
            "tags": ["sql", "data-analysis"],
            "duration_ms": int((t1 - t0) * 1000),
            "total_tokens": total_in + total_out, "total_cost_cents": total_cost,
            "total_spans": len(spans),
            "started_at": ts_rfc3339(t0), "ended_at": ts_rfc3339(t1),
            "error": "" if response else "SQL generation failed",
        }
        ingest_session(session, spans)
        if total_cost > 0:
            send_cost_event(sid, "SQL Agent", LLM_MODEL, total_in, total_out, total_cost)


def run_email_agent():
    """Email Draft Agent — composes professional emails."""
    print("\n✉️  Email Draft Agent")
    requests_list = [
        {"to": "engineering team", "context": "We need to postpone the v2.0 release by two weeks due to critical bugs found in QA. Communicate this diplomatically."},
        {"to": "potential client", "context": "Follow up on our demo call last week. They seemed interested in the enterprise plan but had concerns about data residency in EU."},
        {"to": "board of directors", "context": "Q1 results are strong — 42% revenue growth, 10K new users. But churn increased to 8%. Provide balanced update."},
    ]

    for req in requests_list:
        sid = str(uuid.uuid4())
        t0 = time.time()
        spans = []
        total_in, total_out, total_cost = 0, 0, 0

        print(f"  → Email to {req['to']}: {req['context'][:50]}...")

        # Guard check on input (PII detection)
        guard_result = send_guard_check(req["context"])

        # LLM call to draft email
        s1_start = time.time()
        messages = [
            {"role": "system", "content": "You are a professional communication specialist. Draft a clear, well-structured email. Include subject line. Keep under 200 words. Be professional but warm."},
            {"role": "user", "content": f"Recipient: {req['to']}\nContext: {req['context']}\n\nDraft the email:"},
        ]
        response, usage = llm_call(messages, max_tokens=400)
        s1_end = time.time()

        if response:
            cost = calc_cost_cents(usage)
            total_in += usage.get("prompt_tokens", 0)
            total_out += usage.get("completion_tokens", 0)
            total_cost += cost
            spans.append({
                "id": str(uuid.uuid4()), "session_id": sid,
                "name": "draft-email", "span_type": "llm_call",
                "status": "completed",
                "input": json.dumps({"to": req["to"]}),
                "output": json.dumps({"draft": response[:500]}),
                "model": LLM_MODEL, "provider": "lmstudio",
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "cost_cents": cost,
                "duration_ms": int((s1_end - s1_start) * 1000),
                "metadata": "{}",
                "started_at": ts_rfc3339(s1_start), "ended_at": ts_rfc3339(s1_end),
            })
            print(f"    ✓ Draft: {response[:80]}...")

        t1 = time.time()
        session = {
            "id": sid, "agent_name": "Email Agent",
            "status": "completed" if response else "failed",
            "metadata": json.dumps({"recipient": req["to"]}),
            "tags": ["email", "communication"],
            "duration_ms": int((t1 - t0) * 1000),
            "total_tokens": total_in + total_out, "total_cost_cents": total_cost,
            "total_spans": len(spans),
            "started_at": ts_rfc3339(t0), "ended_at": ts_rfc3339(t1),
            "error": "" if response else "Draft failed",
        }
        ingest_session(session, spans)
        if total_cost > 0:
            send_cost_event(sid, "Email Agent", LLM_MODEL, total_in, total_out, total_cost)


def run_devops_incident_agent():
    """DevOps Incident Agent — diagnoses production incidents."""
    print("\n🚨 DevOps Incident Agent")
    incidents = [
        {"severity": "P1", "alert": "API latency p99 spiked to 12s (normal: 200ms). Affecting /v1/users endpoint. Started 10 minutes ago."},
        {"severity": "P2", "alert": "Memory usage on worker-pool-3 at 94%. OOM kills detected. 3 pods restarted in last hour."},
        {"severity": "P3", "alert": "Certificate expiry warning: api.production.internal.io expires in 7 days. Auto-renewal failed."},
    ]

    for incident in incidents:
        sid = str(uuid.uuid4())
        t0 = time.time()
        spans = []
        total_in, total_out, total_cost = 0, 0, 0

        print(f"  → [{incident['severity']}] {incident['alert'][:60]}...")

        # Span 1: Metrics fetch (tool call)
        s1_start = time.time()
        time.sleep(random.uniform(0.05, 0.15))
        s1_end = time.time()
        spans.append({
            "id": str(uuid.uuid4()), "session_id": sid,
            "name": "fetch-metrics", "span_type": "tool_call",
            "status": "completed",
            "input": json.dumps({"source": "prometheus", "query": "http_request_duration_seconds"}),
            "output": json.dumps({"data_points": random.randint(50, 200), "anomalies": random.randint(1, 5)}),
            "model": "", "provider": "",
            "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
            "cost_cents": 0,
            "duration_ms": int((s1_end - s1_start) * 1000),
            "metadata": json.dumps({"tool": "prometheus_api"}),
            "started_at": ts_rfc3339(s1_start), "ended_at": ts_rfc3339(s1_end),
        })

        # Span 2: Log analysis (tool call)
        s2_start = time.time()
        time.sleep(random.uniform(0.03, 0.1))
        s2_end = time.time()
        spans.append({
            "id": str(uuid.uuid4()), "session_id": sid,
            "name": "analyze-logs", "span_type": "tool_call",
            "status": "completed",
            "input": json.dumps({"source": "loki", "time_range": "30m"}),
            "output": json.dumps({"log_lines": random.randint(500, 5000), "error_lines": random.randint(10, 200)}),
            "model": "", "provider": "",
            "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
            "cost_cents": 0,
            "duration_ms": int((s2_end - s2_start) * 1000),
            "metadata": json.dumps({"tool": "loki_api"}),
            "started_at": ts_rfc3339(s2_start), "ended_at": ts_rfc3339(s2_end),
        })

        # Span 3: LLM diagnosis
        s3_start = time.time()
        messages = [
            {"role": "system", "content": "You are a senior SRE. Diagnose the incident based on the alert and metrics. Provide: 1) Root cause hypothesis, 2) Impact assessment, 3) Immediate mitigation steps, 4) Long-term fix. Keep under 200 words."},
            {"role": "user", "content": f"Severity: {incident['severity']}\nAlert: {incident['alert']}\n\nMetrics show anomalous patterns in the last 30 minutes. Error logs contain connection timeout errors.\n\nDiagnose:"},
        ]
        response, usage = llm_call(messages, max_tokens=400)
        s3_end = time.time()

        if response:
            cost = calc_cost_cents(usage)
            total_in += usage.get("prompt_tokens", 0)
            total_out += usage.get("completion_tokens", 0)
            total_cost += cost
            spans.append({
                "id": str(uuid.uuid4()), "session_id": sid,
                "name": "incident-diagnosis", "span_type": "llm_call",
                "status": "completed",
                "input": json.dumps({"severity": incident["severity"]}),
                "output": json.dumps({"diagnosis": response[:500]}),
                "model": LLM_MODEL, "provider": "lmstudio",
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "cost_cents": cost,
                "duration_ms": int((s3_end - s3_start) * 1000),
                "metadata": "{}",
                "started_at": ts_rfc3339(s3_start), "ended_at": ts_rfc3339(s3_end),
            })
            print(f"    ✓ Diagnosis: {response[:80]}...")

        t1 = time.time()
        session = {
            "id": sid, "agent_name": "DevOps Incident Agent",
            "status": "completed" if response else "failed",
            "metadata": json.dumps({"severity": incident["severity"]}),
            "tags": ["devops", "incident", incident["severity"].lower()],
            "duration_ms": int((t1 - t0) * 1000),
            "total_tokens": total_in + total_out, "total_cost_cents": total_cost,
            "total_spans": len(spans),
            "started_at": ts_rfc3339(t0), "ended_at": ts_rfc3339(t1),
            "error": "" if response else "Diagnosis failed",
        }
        ingest_session(session, spans)
        if total_cost > 0:
            send_cost_event(sid, "DevOps Incident Agent", LLM_MODEL, total_in, total_out, total_cost)


def run_content_writing_agent():
    """Content Writing Agent — generates blog posts and marketing copy."""
    print("\n✍️  Content Writing Agent")
    briefs = [
        {"type": "blog", "topic": "Why observability matters for AI agents in production", "audience": "engineering leads"},
        {"type": "landing", "topic": "Announce our new self-healing SDK feature", "audience": "developers"},
    ]

    for brief in briefs:
        sid = str(uuid.uuid4())
        t0 = time.time()
        spans = []
        total_in, total_out, total_cost = 0, 0, 0

        print(f"  → {brief['type'].title()}: {brief['topic'][:50]}...")

        # Span 1: Outline generation
        s1_start = time.time()
        messages = [
            {"role": "system", "content": f"Create a concise outline for a {brief['type']} post. Target audience: {brief['audience']}. Include 3-4 sections. Just the outline — bullet points only. Max 100 words."},
            {"role": "user", "content": brief["topic"]},
        ]
        outline, usage1 = llm_call(messages, max_tokens=200)
        s1_end = time.time()

        if outline:
            cost1 = calc_cost_cents(usage1)
            total_in += usage1.get("prompt_tokens", 0)
            total_out += usage1.get("completion_tokens", 0)
            total_cost += cost1
            spans.append({
                "id": str(uuid.uuid4()), "session_id": sid,
                "name": "generate-outline", "span_type": "llm_call",
                "status": "completed",
                "input": json.dumps({"topic": brief["topic"]}),
                "output": json.dumps({"outline": outline[:300]}),
                "model": LLM_MODEL, "provider": "lmstudio",
                "input_tokens": usage1.get("prompt_tokens", 0),
                "output_tokens": usage1.get("completion_tokens", 0),
                "total_tokens": usage1.get("total_tokens", 0),
                "cost_cents": cost1,
                "duration_ms": int((s1_end - s1_start) * 1000),
                "metadata": "{}",
                "started_at": ts_rfc3339(s1_start), "ended_at": ts_rfc3339(s1_end),
            })

            # Span 2: Full draft
            s2_start = time.time()
            messages2 = [
                {"role": "system", "content": f"Write the {brief['type']} post based on this outline. Target: {brief['audience']}. Engaging, informative. Keep under 300 words."},
                {"role": "user", "content": f"Topic: {brief['topic']}\n\nOutline:\n{outline}\n\nWrite the full post:"},
            ]
            draft, usage2 = llm_call(messages2, max_tokens=600)
            s2_end = time.time()

            if draft:
                cost2 = calc_cost_cents(usage2)
                total_in += usage2.get("prompt_tokens", 0)
                total_out += usage2.get("completion_tokens", 0)
                total_cost += cost2
                spans.append({
                    "id": str(uuid.uuid4()), "session_id": sid,
                    "name": "write-draft", "span_type": "llm_call",
                    "status": "completed",
                    "input": json.dumps({"task": "full_draft"}),
                    "output": json.dumps({"draft": draft[:500], "word_count": len(draft.split())}),
                    "model": LLM_MODEL, "provider": "lmstudio",
                    "input_tokens": usage2.get("prompt_tokens", 0),
                    "output_tokens": usage2.get("completion_tokens", 0),
                    "total_tokens": usage2.get("total_tokens", 0),
                    "cost_cents": cost2,
                    "duration_ms": int((s2_end - s2_start) * 1000),
                    "metadata": "{}",
                    "started_at": ts_rfc3339(s2_start), "ended_at": ts_rfc3339(s2_end),
                })
                print(f"    ✓ Draft ({len(draft.split())} words): {draft[:80]}...")

        t1 = time.time()
        session = {
            "id": sid, "agent_name": "Writing Agent",
            "status": "completed" if outline else "failed",
            "metadata": json.dumps({"type": brief["type"], "audience": brief["audience"]}),
            "tags": ["content", brief["type"]],
            "duration_ms": int((t1 - t0) * 1000),
            "total_tokens": total_in + total_out, "total_cost_cents": total_cost,
            "total_spans": len(spans),
            "started_at": ts_rfc3339(t0), "ended_at": ts_rfc3339(t1),
            "error": "" if outline else "Content generation failed",
        }
        ingest_session(session, spans)
        if total_cost > 0:
            send_cost_event(sid, "Writing Agent", LLM_MODEL, total_in, total_out, total_cost)


def run_meeting_summary_agent():
    """Meeting Summary Agent — extracts action items from transcripts."""
    print("\n📝 Meeting Summary Agent")

    transcript = """
    Sarah (PM): Let's discuss the Q2 roadmap. We need to ship the analytics dashboard by April 15th.
    Mike (Eng): The backend API is almost done. I need two more days for the aggregation endpoints.
    Lisa (Design): The mockups are approved. I'll hand off the Figma files to frontend today.
    Sarah: Great. Mike, can you also set up the staging environment by Friday?
    Mike: Sure, I'll need DevOps to provision the database first though.
    Sarah: I'll ping the DevOps team. Lisa, please also prepare the mobile responsive designs.
    Lisa: Will do, I'll have those ready by Wednesday.
    Sarah: Perfect. Let's reconvene Thursday to check progress. Meeting adjourned.
    """

    sid = str(uuid.uuid4())
    t0 = time.time()
    spans = []
    total_in, total_out, total_cost = 0, 0, 0

    print(f"  → Summarizing meeting transcript...")

    s1_start = time.time()
    messages = [
        {"role": "system", "content": "Extract a structured meeting summary from the transcript. Include: 1) Key decisions, 2) Action items with owners and deadlines, 3) Open questions. Use bullet points. Be concise."},
        {"role": "user", "content": f"Meeting transcript:\n{transcript}\n\nProvide the structured summary:"},
    ]
    response, usage = llm_call(messages, max_tokens=400)
    s1_end = time.time()

    if response:
        cost = calc_cost_cents(usage)
        total_in += usage.get("prompt_tokens", 0)
        total_out += usage.get("completion_tokens", 0)
        total_cost += cost
        spans.append({
            "id": str(uuid.uuid4()), "session_id": sid,
            "name": "extract-summary", "span_type": "llm_call",
            "status": "completed",
            "input": json.dumps({"transcript_length": len(transcript.split())}),
            "output": json.dumps({"summary": response[:500]}),
            "model": LLM_MODEL, "provider": "lmstudio",
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
            "cost_cents": cost,
            "duration_ms": int((s1_end - s1_start) * 1000),
            "metadata": json.dumps({"participants": 3}),
            "started_at": ts_rfc3339(s1_start), "ended_at": ts_rfc3339(s1_end),
        })
        print(f"    ✓ Summary: {response[:80]}...")

    t1 = time.time()
    session = {
        "id": sid, "agent_name": "Meeting Summary Agent",
        "status": "completed" if response else "failed",
        "metadata": json.dumps({"participants": ["Sarah", "Mike", "Lisa"], "duration_min": 15}),
        "tags": ["meeting", "summary"],
        "duration_ms": int((t1 - t0) * 1000),
        "total_tokens": total_in + total_out, "total_cost_cents": total_cost,
        "total_spans": len(spans),
        "started_at": ts_rfc3339(t0), "ended_at": ts_rfc3339(t1),
        "error": "" if response else "Summary failed",
    }
    ingest_session(session, spans)
    if total_cost > 0:
        send_cost_event(sid, "Meeting Summary Agent", LLM_MODEL, total_in, total_out, total_cost)


# ---------------------------------------------------------------------------
# Register agents and run
# ---------------------------------------------------------------------------
def register_agents():
    """Register all agent definitions."""
    print("\n📋 Registering agents...")
    agents = [
        ("Customer Support Agent", "Handles customer support tickets using RAG + LLM", ["support", "production"]),
        ("Code Review Agent", "Reviews code for security vulnerabilities and bugs", ["code-review", "security"]),
        ("Research Agent", "Multi-step research with web search and synthesis", ["research", "multi-step"]),
        ("SQL Agent", "Translates natural language to SQL queries", ["sql", "data-analysis"]),
        ("Email Agent", "Drafts professional emails from context", ["email", "communication"]),
        ("DevOps Incident Agent", "Diagnoses production incidents from metrics and logs", ["devops", "incident"]),
        ("Writing Agent", "Generates blog posts and marketing content", ["content", "writing"]),
        ("Meeting Summary Agent", "Extracts action items from meeting transcripts", ["meeting", "summary"]),
    ]
    for name, desc, tags in agents:
        result = api_post("/v1/agents", {"name": name, "description": desc, "tags": tags})
        status = "✓" if result is not None else "✗"
        print(f"  {status} {name}")


def main():
    print("=" * 60)
    print("  AgentStack — Real Agent Simulation")
    print(f"  LLM: {LLM_MODEL} via LM Studio")
    print(f"  API: {API_URL}")
    print("=" * 60)

    # Verify connectivity
    try:
        r = requests.get(f"{API_URL}/health", timeout=5)
        print(f"\n[ok] API server healthy")
    except:
        print(f"\n[err] Cannot reach API server at {API_URL}")
        sys.exit(1)

    try:
        r = requests.get(f"{LLM_URL}/v1/models", timeout=5)
        models = [m["id"] for m in r.json().get("data", [])]
        print(f"[ok] LM Studio models: {', '.join(models)}")
    except:
        print(f"[err] Cannot reach LM Studio at {LLM_URL}")
        sys.exit(1)

    # Register agents
    register_agents()

    # Run all agent scenarios
    t_start = time.time()

    run_customer_support_agent()    # 5 sessions
    run_code_review_agent()         # 3 sessions
    run_research_agent()            # 3 sessions (multi-step)
    run_sql_agent()                 # 4 sessions
    run_email_agent()               # 3 sessions
    run_devops_incident_agent()     # 3 sessions
    run_content_writing_agent()     # 2 sessions (multi-step)
    run_meeting_summary_agent()     # 1 session

    elapsed = time.time() - t_start
    print(f"\n{'=' * 60}")
    print(f"  Done! 24 agent sessions completed in {elapsed:.1f}s")
    print(f"  Check the dashboard: http://localhost:3000/dashboard/overview")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()

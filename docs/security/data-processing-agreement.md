# Data Processing Agreement (DPA)

**Template version:** 1.0
**Last updated:** 2025-01-15

> This is a template DPA for AgentStack customers. Replace bracketed placeholders with the appropriate values before signing.

---

## 1. Parties

- **Data Controller** ("Customer"): [Customer Legal Name], [Address]
- **Data Processor** ("AgentStack"): AgentStack, Inc., [Address]

This DPA forms part of the service agreement ("Agreement") between the Customer and AgentStack for the use of the AgentStack platform ("Service").

---

## 2. Definitions

| Term | Definition |
|------|-----------|
| **Personal Data** | Any information relating to an identified or identifiable natural person, as defined by applicable data protection laws (GDPR Art. 4(1), CCPA, etc.) |
| **Processing** | Any operation performed on Personal Data, including collection, storage, retrieval, analysis, and deletion |
| **Sub-processor** | A third party engaged by AgentStack to process Personal Data on behalf of the Customer |
| **Data Subject** | The individual to whom Personal Data relates |

---

## 3. Data Collected

AgentStack processes the following categories of data on behalf of the Customer:

### 3.1 Data the Customer Sends via the SDK

| Category | Examples | Purpose |
|----------|----------|---------|
| **Trace data** | Session metadata, span names, timing, token counts, model names | Observability and debugging |
| **LLM inputs and outputs** | Prompts and completions sent through the SDK or gateway | Session replay, evaluation, guardrail enforcement |
| **Agent metadata** | Agent names, configuration labels, version tags | Organization and filtering |
| **Cost data** | Token counts, model identifiers, cost calculations | Cost tracking and budget enforcement |
| **Healing events** | Intervention type, trigger reason, before/after state | Self-healing analytics |
| **Guard events** | Content checked, rule applied, pass/block result | Guardrail monitoring |

### 3.2 Data Collected Automatically

| Category | Examples | Purpose |
|----------|----------|---------|
| **Account data** | Email address, name, GitHub profile (from OAuth) | Authentication and account management |
| **Usage metadata** | API request counts, timestamps, IP addresses | Rate limiting, security, analytics |
| **Audit logs** | Actions performed, actor identity, timestamps | Security and compliance |

### 3.3 Data AgentStack Does NOT Collect

- AgentStack does not independently collect Personal Data from end users of the Customer's AI agents.
- All LLM inputs and outputs are sent to AgentStack only because the Customer configured the SDK to transmit them.
- The Customer controls what data is included in trace spans and can exclude sensitive fields via SDK configuration.

---

## 4. How Data Is Processed

### 4.1 Processing Activities

| Activity | Description |
|----------|-------------|
| **Ingestion** | Data is received via HTTPS, validated, and published to an internal message queue (NATS) |
| **Storage** | Time-series data is stored in ClickHouse; configuration data in PostgreSQL; cache in Redis |
| **Analysis** | Aggregation for analytics dashboards, pattern matching for failure detection, evaluation scoring |
| **Guardrail enforcement** | Content is checked against configured rules (PII detection, toxicity, etc.) |
| **Gateway proxying** | LLM requests routed through the gateway are logged for cost tracking and observability |
| **Display** | Data is rendered in the AgentStack dashboard for authorized users |

### 4.2 Processing Locations

- **Self-hosted deployments**: Data is processed and stored entirely within the Customer's infrastructure. AgentStack has no access to the data.
- **Cloud deployments**: Data is processed in [Region, e.g., US-East-1 (AWS)]. The Customer may request a specific region.

### 4.3 Processing Lawfulness

AgentStack processes Personal Data solely on documented instructions from the Customer (i.e., the Customer's use of the SDK and API constitutes the instruction). AgentStack does not process Personal Data for its own purposes beyond providing the Service.

---

## 5. Retention Periods

| Data Type | Default Retention | Configurable |
|-----------|-------------------|-------------|
| Trace sessions and spans | 30 days (Cloud), 90 days (Team), unlimited (self-hosted) | Yes, per organization |
| Healing events | Same as trace data | Yes |
| Guard events | Same as trace data | Yes |
| Gateway request logs | 30 days | Yes |
| Audit logs | 90 days | Yes |
| Account data | Duration of the Agreement + 30 days | Deleted on account closure |
| Backups | 7 days after the source data is deleted | Fixed |

After the retention period, data is automatically purged. The Customer can also request immediate deletion (see Section 6).

---

## 6. Deletion Procedures

### 6.1 Customer-Initiated Deletion

The Customer can delete data at any time using the GDPR API endpoints:

| Endpoint | Scope |
|----------|-------|
| `DELETE /v1/gdpr/sessions?before=<timestamp>` | Delete sessions older than a date |
| `DELETE /v1/gdpr/user/{user_id}` | Delete all data for a specific user |
| `DELETE /v1/gdpr/org/{org_id}` | Delete all data for an organization |

Deletions are:
- Logged in the audit trail
- Applied to PostgreSQL, ClickHouse, and Redis
- Irreversible once completed

### 6.2 Data Subject Requests

If a Data Subject exercises their right to erasure (GDPR Art. 17), the Customer is responsible for initiating the deletion via the API. AgentStack will assist upon request.

### 6.3 Account Closure

When the Customer terminates the Agreement:

1. The Customer has 30 days to export their data via `GET /v1/gdpr/export/{user_id}`.
2. After 30 days, all Customer data is permanently deleted from all systems.
3. AgentStack provides written confirmation of deletion upon request.

### 6.4 Backup Deletion

Deleted data may persist in encrypted backups for up to 7 days. Backups are automatically rotated, and deleted data becomes unrecoverable after the backup rotation period.

---

## 7. Sub-processors

AgentStack uses the following sub-processors for the cloud-hosted service:

| Sub-processor | Purpose | Data Processed | Location |
|---------------|---------|---------------|----------|
| [Cloud Provider, e.g., AWS] | Infrastructure hosting | All data | [Region] |
| [Email Provider, e.g., SendGrid] | Alert email delivery | Email addresses, alert content | US |

### 7.1 Self-Hosted Deployments

When the Customer self-hosts AgentStack, no sub-processors are used. All data remains within the Customer's infrastructure.

### 7.2 Changes to Sub-processors

AgentStack will notify the Customer at least 30 days before engaging a new sub-processor. The Customer may object in writing within 15 days. If the objection cannot be resolved, the Customer may terminate the Agreement.

### 7.3 Sub-processor Obligations

Each sub-processor is bound by a data processing agreement that imposes obligations no less protective than this DPA.

---

## 8. Security Measures

AgentStack implements the following technical and organizational measures:

### Technical Measures

| Measure | Implementation |
|---------|---------------|
| Encryption in transit | TLS 1.2+ on all external connections |
| Encryption at rest | AES-256-GCM for secrets; volume-level encryption for databases |
| Access control | RBAC (Owner/Admin/Viewer); scoped API keys |
| Authentication | JWT with configurable expiration; API key hashing (SHA-256); SSO (SAML/OIDC) |
| Network security | Security headers (HSTS, X-Frame-Options, etc.); rate limiting; CORS restrictions |
| Input validation | Parameterized database queries; request body validation; size limits |
| Logging | Audit logs for all configuration changes and access events |
| Monitoring | Prometheus metrics; health checks; alerting |

### Organizational Measures

| Measure | Description |
|---------|-------------|
| Access to production | Limited to authorized personnel with a business need |
| Incident response | Defined process with notification within 72 hours (see Section 9) |
| Employee training | Security awareness training for all team members |
| Vendor assessment | Security review of all sub-processors before engagement |

---

## 9. Breach Notification

In the event of a Personal Data breach:

1. AgentStack will notify the Customer without undue delay, and no later than **72 hours** after becoming aware of the breach.
2. The notification will include:
   - Nature of the breach (categories and approximate number of records affected)
   - Name and contact details of the point of contact
   - Likely consequences of the breach
   - Measures taken or proposed to address the breach
3. AgentStack will cooperate with the Customer's investigation and any notification obligations to supervisory authorities or Data Subjects.

---

## 10. Data Subject Rights

AgentStack will assist the Customer in responding to Data Subject requests, including:

| Right | How AgentStack Supports It |
|-------|---------------------------|
| Access (Art. 15) | Data export API: `GET /v1/gdpr/export/{user_id}` |
| Rectification (Art. 16) | Customer can update data via the API and dashboard |
| Erasure (Art. 17) | Deletion API: `DELETE /v1/gdpr/user/{user_id}` |
| Restriction (Art. 18) | Customer can disable user accounts and revoke API keys |
| Portability (Art. 20) | Data export API returns machine-readable JSON |
| Objection (Art. 21) | Customer controls all data transmission via SDK configuration |

---

## 11. International Transfers

If Personal Data is transferred outside the European Economic Area (EEA):

- AgentStack relies on **Standard Contractual Clauses (SCCs)** as adopted by the European Commission.
- The Customer may request a copy of the executed SCCs.
- For self-hosted deployments, no international transfer occurs unless the Customer deploys outside the EEA.

---

## 12. Audit Rights

The Customer may audit AgentStack's compliance with this DPA:

- By reviewing AgentStack's SOC 2 report (when available) and security documentation.
- By requesting answers to a written security questionnaire (up to once per year).
- By conducting or commissioning an on-site audit with 30 days written notice, at the Customer's expense, during normal business hours.

---

## 13. Term and Termination

- This DPA is effective for the duration of the Agreement.
- Upon termination, AgentStack will delete all Customer data as described in Section 6.3.
- Sections 6 (Deletion), 8 (Security), 9 (Breach Notification), and 12 (Audit) survive termination.

---

## Signatures

| | Data Controller (Customer) | Data Processor (AgentStack) |
|-|----------------------------|----------------------------|
| Name | __________________________ | __________________________ |
| Title | __________________________ | __________________________ |
| Date | __________________________ | __________________________ |
| Signature | __________________________ | __________________________ |

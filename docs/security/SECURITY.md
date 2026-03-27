# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AgentStack, please report it responsibly. **Do not open a public GitHub issue.**

### Contact

Email: **security@agentstack.dev**

Include the following in your report:

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact
- Suggested fix (if you have one)

### Response Timeline

| Action | Timeline |
|--------|----------|
| Acknowledgment of your report | Within 48 hours |
| Initial assessment and severity classification | Within 5 business days |
| Fix developed and tested | Within 30 days for critical/high severity |
| Public disclosure (coordinated) | After the fix is released |

We follow coordinated disclosure. We will credit you in the release notes unless you prefer to remain anonymous.

### Severity Classification

| Severity | Examples |
|----------|----------|
| **Critical** | Remote code execution, authentication bypass, data exfiltration |
| **High** | SQL injection, privilege escalation, API key exposure |
| **Medium** | Stored XSS, CSRF, information disclosure of non-sensitive data |
| **Low** | Missing security headers, verbose error messages, minor info leaks |

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Previous minor release | Security fixes only |
| Older versions | No |

We recommend always running the latest version. Self-hosted deployments should update regularly to receive security patches.

## Security Practices

- All dependencies are tracked in `go.mod` (Go) and `package-lock.json` (Node.js) and updated regularly.
- Secrets (API keys, provider keys) are hashed or encrypted (AES-256-GCM) before storage.
- All database queries use parameterized arguments.
- Rate limiting is enforced on all API endpoints.
- JWTs have configurable expiration and are signed with HS256.
- The API server sets security headers: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.

## Bug Bounty

We do not currently operate a formal bug bounty program. However, we deeply appreciate responsible disclosure and will acknowledge contributors publicly (with permission) in our release notes.

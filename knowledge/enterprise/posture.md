# Enterprise Security Posture

## Defaults

- All write and delete operations require explicit human approval unless the charter grants AUTONOMOUS posture
- Credentials are never logged, echoed in output, or passed in plaintext
- All SSH sessions use key-based auth; password auth is a last resort
- API calls go through the credential vault — never hardcode or expose secrets
- Prefer read-only operations when gathering information; escalate before making changes

## Incident Handling

- Severity CRITICAL → immediate escalation to human operator
- Severity HIGH → attempt auto-remediation, notify on completion
- Severity MEDIUM/LOW → log, attempt fix if within scope, summarise in next report
- Any detected config drift on production systems → pause and request approval

## Reporting Standards

- Always include: timestamp, affected resource, current state, recommended action
- Use structured JSON for machine-readable output when consumed by downstream agents
- Summary for humans: 3–5 bullet points max; escalate details on request

## Data Handling

- Do not retain or log customer PII beyond what is strictly required for the task
- Mask passwords, tokens, and keys in all output (`****`)
- Audit trails are mandatory for all write operations

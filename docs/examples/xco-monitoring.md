# Example: XCO Network Monitoring Agent

This walkthrough builds an agent that monitors Extreme Networks XCO (cloud orchestrator) fabric switches — checking for alarms, config drift, and topology changes — and automatically requests remediation when issues are found.

**Key differences from XIQ:** XCO is typically on a private network (VPN/intranet). The agent checks reachability before attempting any XCO operation, and SSH access is used alongside the REST API.

---

## Prerequisites

- Forge running with all services active
- Access to your XCO instance (VPN connected if required)
- SSH credentials for the XCO controller
- XCO API credentials (client ID + secret for OAuth2, or username/password)

---

## Part 1 — Store XCO Credentials

XCO uses OAuth2 client credentials. Store them in the vault:

### In Telegram or Dashboard Chat

```
Create a credential named "XCO Production" with:
- Type: OAuth2 Client Credentials
- Client ID: your-client-id
- Client Secret: your-client-secret
- Token URL: https://xco.corp.internal/oauth2/token
- Scope: read write
```

Also store SSH credentials for direct device access:

```
Create a credential named "XCO SSH" with:
- Type: SSH Key
- Username: admin
- Private key: (paste your PEM key)
```

---

## Part 2 — Register the XCO Endpoint

Register the XCO instance so the tool router knows how to reach it:

```
Register an endpoint named "XCO Production":
- Base URL: https://xco.corp.internal
- Tags: networking, xco, primary
- Notes: XCO REST API at /rest/v1/. Requires VPN access.
         OAuth2 at /oauth2/token. Rate limit: 120 req/min.
```

The endpoint is stored in the `Endpoint` table and used by the tool router for reachability checks. If the URL is unreachable (VPN disconnected), XCO tools are automatically skipped and the agent reports the connectivity issue.

---

## Part 3 — Build the XCO Skills

```
Build a skill set for XCO using:
- OpenAPI spec: https://xco.corp.internal/rest/v1/openapi.json
- Base URL: https://xco.corp.internal/rest/v1
- Domain prefix: xco
- Handler: xco_http_call (private network, reachability-checked)
- Credential: XCO Production

Also include SSH access for direct device commands.
```

The XCO handler (`xco_http_call`) differs from the public handler:
- Checks endpoint reachability before every call (cached 5 min)
- Returns a clear error if the network is unreachable: `"XCO is not reachable — check VPN connection"`
- Supports OAuth2 token refresh

---

## Part 4 — Create the XCO Monitoring Agent

```
Create an agent called "XCO Monitor" with:
- LLM: gpt-4o
- Skills: all xco.* skills
- Credential: XCO Production
- SSH Credential: XCO SSH  
- Permissions: read:network, ssh:exec
- No write permissions (read-only monitor)
- Charter: monitor XCO fabric, report issues, escalate for remediation
```

### Agent Charter

The charter constrains what the agent can do:

```json
{
  "name": "XCO Monitor Charter",
  "objectives": [
    "Monitor XCO fabric health every hour",
    "Detect and report critical/major alarms",
    "Identify configuration drift from baseline",
    "Escalate issues requiring remediation to a specialist agent"
  ],
  "constraints": {
    "allowedOperations": ["read", "ssh:exec"],
    "maxTokensPerRun": 8000,
    "requireApprovalFor": ["any_write"],
    "escalationThreshold": "any_critical_alarm"
  },
  "escalation": {
    "channel": "telegram",
    "message": "Critical alarm detected — escalating to XCO Remediation Agent",
    "spawnAgent": "XCO Remediation"
  }
}
```

---

## Part 5 — Test Connectivity

Before scheduling, test the agent manually:

```
Check if XCO is reachable and show me the fabric topology
```

If VPN is connected:
```
✅ XCO is reachable (https://xco.corp.internal — 45ms)

Fabric Topology:
  Spine switches: 2 (SW-SPINE-01, SW-SPINE-02)
  Leaf switches:  8 (SW-LEAF-01 through SW-LEAF-08)
  Status: All switches online, no active alarms
```

If VPN is disconnected:
```
⚠️ XCO is not reachable — https://xco.corp.internal timed out.
Please check your VPN connection.
XCO operations are unavailable until connectivity is restored.
```

---

## Part 6 — Test Alarm Detection

```
Show me any active alarms on the XCO fabric
```

```
Run an SSH command on SW-SPINE-01: show version
```

---

## Part 7 — Create the Remediation Agent

A separate agent handles remediation — with write permissions and strict approval gates:

```
Create an agent called "XCO Remediation" with:
- LLM: gpt-4o
- Skills: all xco.* skills
- Permissions: read:network, write:network, ssh:exec
- Requires approval for ALL write and SSH exec operations
- Charter: only execute remediation plans approved by XCO Monitor
```

---

## Part 8 — Schedule Monitoring

```
Schedule the XCO Monitor agent to run every hour:
- Cron: 0 * * * *
- Message: "Check fabric health: active alarms, offline switches,
            interface errors > 1000 in last hour, config drift.
            Summarise status and escalate any critical issues."
```

### What Happens on Each Run

**Healthy network:**
```
[XCO Monitor — hourly] ✅ Fabric healthy
  • 10/10 switches online
  • 0 active alarms
  • 0 interfaces with errors
  • Config drift: none detected
```
*(Logged silently — no Telegram notification)*

**Issues found:**
```
[XCO Monitor — hourly] ⚠️ 2 issues detected:

1. 🔴 Critical: SW-LEAF-03 — BGP session down (peer 10.0.0.1)
   Duration: 23 minutes
   Proposed: Check BGP config, verify peer connectivity

2. 🟡 Major: SW-SPINE-01 — Interface eth1/24 error rate: 2,847 errors/hr
   Proposed: Check cable/SFP, run interface diagnostics

Spawning XCO Remediation Agent for approval...
```

Telegram message:
```
🚨 XCO Alert — Action Required

1. SW-LEAF-03: BGP session down (23 min)
2. SW-SPINE-01: Interface eth1/24 errors (2,847/hr)

XCO Remediation Agent has proposed fixes.
Review and approve at: http://forge.corp/approvals/abc123

[✅ Approve remediation] [❌ Deny]
```

---

## SSH Commands

The XCO agent can run SSH commands on target devices when API endpoints are insufficient:

```
Run "show fabric topology" on SW-SPINE-01
```

```
Check interface status on all leaf switches
```

```
What is the running configuration of SW-LEAF-03's BGP process?
```

SSH commands require the `ssh:exec` permission and an SSH credential assigned to the agent. All commands are logged in the audit trail.

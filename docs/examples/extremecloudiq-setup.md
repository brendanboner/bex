# Example: ExtremeCloud IQ — Full Setup

This walkthrough goes from zero to a fully operational XIQ agent that can:
- List and inspect devices and clients
- Configure VLANs, SSIDs, and network policies
- Monitor for alarms and send Telegram alerts
- Run hourly health checks with human-in-the-loop approval for any changes

Estimated time: **20 minutes**

---

## Prerequisites

- Forge running with `bex start` (see [Getting Started](../guides/getting-started.md))
- Telegram bot configured (or use the dashboard chat)
- ExtremeCloud IQ account: `you@yourcompany.com` / your password

---

## Part 1 — Store XIQ Credentials

First, store your XIQ credentials securely in the vault.

### Via Dashboard

1. Go to **Credentials → New Credential**
2. Fill in:
   - **Name**: `XIQ Production`
   - **Type**: `Basic Auth (username + password)`
   - **Username**: `you@yourcompany.com`
   - **Password**: `your-xiq-password`
3. Click **Save**

### Via Telegram

```
Create a credential named "XIQ Production" with username you@yourcompany.com
and password <your-password>
```

The agent will confirm storage and give you the credential ID.

---

## Part 2 — Build the XIQ Skills

Tell the agent to build a comprehensive skill set from the XIQ OpenAPI spec.

### In Telegram or Dashboard Chat

```
Build a complete skill set for ExtremeCloud IQ using the OpenAPI spec at
https://api.extremecloudiq.com/openapi

Base URL: https://api.extremecloudiq.com
Authentication: Basic Auth (username + password)
```

The skill engine will:
1. Fetch the OpenAPI spec (~588 operations)
2. Group by tag into ~15 skill domains
3. Generate tool definitions for each operation
4. Build system prompts with:
   - Pagination guidance (always use `limit=100`)
   - Search patterns (searchString for partial name matches)
   - ID-chaining (list first, then get by ID)
   - Write safety (confirm before POST/PUT/PATCH/DELETE)
5. Run automated tests
6. Ask for your approval:

```
✅ Skill build complete:
   • extremecloudiq.devices   (45 tools — 38 read, 7 write)
   • extremecloudiq.clients   (12 tools — 10 read, 2 write)
   • extremecloudiq.vlans     (8 tools — 5 read, 3 write)
   • extremecloudiq.ssids     (11 tools — 6 read, 5 write)
   • ... (11 more)

Publish all 15 skills to the registry? [Approve / Deny]
```

Tap **Approve** (or type `approve`).

---

## Part 3 — Create the XIQ Agent

### In Dashboard Chat

```
Create an agent called "XIQ Network Manager" with:
- LLM: gpt-4o
- Skills: all extremecloudiq.* skills
- Credential: XIQ Production
- Permissions: read:network, write:network
- Requires approval for all write operations
```

Or manually in the dashboard:
1. **Agents → New Agent**
2. Name: `XIQ Network Manager`
3. Model: `gpt-4o`
4. Permissions: `read:network`, `write:network`
5. **Skills tab**: Add all `extremecloudiq.*` skills
6. **Credentials tab**: Assign `XIQ Production`
7. Click **Save → Activate**

---

## Part 4 — Test the Agent

Set the new agent as your default in Telegram settings, then test:

```
List all devices
```

Expected:
```
Found 47 devices:

| Hostname          | Status | Model     | IP           |
|-------------------|--------|-----------|--------------|
| Beverly Main AP5010 | Online | AP5010   | 10.1.1.5     |
| Beverly Main AP5010-B | Online | AP5010 | 10.1.1.6     |
| FrontAP3000       | Online | AP3000   | 10.1.2.1     |
...
```

```
List all clients on FrontAP3000
```

Expected:
```
Found 23 clients on FrontAP3000:

| Hostname       | MAC               | IP          | Signal |
|----------------|-------------------|-------------|--------|
| DESKTOP-ABC123 | aa:bb:cc:dd:ee:ff | 10.1.2.100  | -55dBm |
...
```

```
List all iPhones across all APs
```

Expected:
```
Found 2 iPhones:
• iPhone-Brian (10.1.1.42) — FrontAP3000, signal -61dBm
• iPhone-Sarah (10.1.2.88) — Beverly Main AP5010, signal -72dBm
```

---

## Part 5 — Configure a Write Operation (with Approval)

```
Create a new VLAN called "IoT Devices" with VLAN ID 200
```

The agent will:
1. Plan the change: "Creating VLAN 'IoT Devices' (ID: 200)"
2. Request approval:

```
⚠️ Approval Required

Operation: Create VLAN
Details:
  Name: IoT Devices
  VLAN ID: 200
  
This will create a new VLAN in your XIQ organisation.
Approve or deny within 10 minutes.

[✅ Approve] [❌ Deny]
```

Tap **Approve** → the VLAN is created:

```
✅ VLAN created successfully.
   Name: IoT Devices
   VLAN ID: 200
   ID: 1234567890
```

---

## Part 6 — Set Up Hourly Monitoring

```
Set up hourly monitoring for XIQ: check for critical alarms and disconnected
devices, and notify me if anything needs attention
```

The agent creates a scheduled job:
```
✅ Scheduled job created:
   Name: XIQ Hourly Health Check
   Schedule: Every hour (0 * * * *)
   Agent: XIQ Network Manager
   Message: "Check for critical alarms and disconnected devices. 
             Summarise the network health status."
```

Every hour, the agent will:
1. Check for active alarms (critical/major severity)
2. Check for disconnected APs
3. If all clear: log silently
4. If issues found: send Telegram alert and propose remediation

Example alert:
```
🔴 XIQ Alert — 2 issues found:

1. AP "FrontAP3000" has been offline for 47 minutes
   Proposed fix: ping device, check PoE switch port
   
2. SSID "Guest" has high interference on channel 6 (14 APs affected)
   Proposed fix: run auto-channel optimisation

Request remediation with approval? [Yes / No]
```

---

## Summary

You now have:

| Component | Status |
|---|---|
| XIQ credentials | ✅ Stored encrypted in vault |
| 15 XIQ skill domains | ✅ Published to registry |
| XIQ Network Manager agent | ✅ Active with all skills |
| Write operation approval gate | ✅ Configured |
| Hourly monitoring job | ✅ Scheduled |

---

## What to Try Next

```
# Configuration queries
Show me the configuration of SSID "Corporate"
List all VLANs
Show device details for FrontAP3000

# Client analysis
Which clients have been connected for more than 24 hours?
Show me all clients with signal strength below -80dBm

# Configuration changes (will prompt for approval)
Update the "Guest" SSID password to a new value
Add a new AP to the "Branch Office" network policy
Create a new SSID for IoT devices on VLAN 200

# Monitoring
Are there any active critical alarms right now?
Show me device uptime statistics for the last 7 days
```

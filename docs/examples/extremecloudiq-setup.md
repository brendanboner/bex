# Example: ExtremeCloud IQ — Full Setup

This walkthrough goes from zero to a fully operational XIQ monitoring agent that can:
- List and inspect devices, APs, and clients
- Answer complex questions like "Show radio quality by location" or "Map VLAN IDs to IP ranges"
- Monitor for alarms and send Telegram alerts
- Run hourly health checks with human-in-the-loop approval for any changes

Estimated time: **20 minutes**

---

## Prerequisites

- Forge running (`bex status` shows all green)
- ExtremeCloud IQ account credentials
- Telegram bot configured (or use the dashboard chat)

---

## Part 1 — Store XIQ Credentials

Store your XIQ credentials securely in the credential vault.

### Via Dashboard

1. Go to **Vault → New Credential**
2. Fill in:
   - **Name**: `XIQ Production`
   - **Type**: `Basic Auth (username + password)`
   - **Username**: `you@yourcompany.com`
   - **Password**: `your-xiq-password`
3. Click **Save**

### Via API

```bash
curl -X POST http://localhost:4000/credentials \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "XIQ Production",
    "credentialType": "BASIC_AUTH",
    "scope": "GLOBAL",
    "value": {
      "username": "you@yourcompany.com",
      "password": "your-xiq-password"
    }
  }'
```

---

## Part 2 — Create a Persona

Instead of manually configuring an agent, use Personas to generate one from your goal.

### Via Dashboard

1. Go to **Personas → Generate Persona**
2. Enter:
   ```
   Monitor ExtremeCloud IQ for disconnected APs, new client devices, and critical
   alarms. Send alerts via Telegram when issues are found. Run hourly. For write
   operations like VLAN changes or SSID updates, always require human approval.
   ```
3. Review the generated persona:
   - **System Prompt** — tailored to XIQ monitoring
   - **Tone** — e.g. `concise`, `analytical`
   - **Suggested Skills** — `extremecloudiq.*`
   - **Suggested Schedule** — `0 * * * *`
4. Click **Spawn Agent**

Forge creates an `ACTIVE` agent linked to the persona. Navigate to **Agents** to see it.

### Via API

```bash
# Generate persona
curl -X POST http://localhost:4000/personas/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Monitor ExtremeCloud IQ for disconnected APs and critical alarms. Alert via Telegram. Require approval for any write operations."
  }'

# Spawn agent (use persona ID from above response)
curl -X POST http://localhost:4000/personas/$PERSONA_ID/spawn \
  -H "Authorization: Bearer $TOKEN"
```

---

## Part 3 — Build the XIQ Skills

Build a complete skill set from the XIQ OpenAPI spec. This also automatically populates domain intelligence.

### Via Dashboard Chat

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
4. Build system prompts with pagination guidance, search patterns, ID-chaining, and write safety
5. Run `discoverLinkedDocs()` — scrapes XIQ documentation site, finds API guides, CLI reference, troubleshooting pages
6. Run `generatePlaybooks()` — generates playbooks including:
   - **radio-quality-by-location** — triggered by words like "radio", "quality", "location", "signal"
   - **vlan-ip-range-mapping** — triggered by "vlan", "ip", "range", "subnet"
   - **client-health-overview** — triggered by "client", "health", "connected", "overview"
   - **new-device-detection** — triggered by "new", "device", "detected", "joined"
7. Store all domain intelligence in `DomainKnowledge` for `domain: "extremecloudiq"`
8. Run automated tests
9. Ask for your approval:

```
✅ Skill build complete:
   • extremecloudiq.devices   (45 tools — 38 read, 7 write)
   • extremecloudiq.clients   (12 tools — 10 read, 2 write)
   • extremecloudiq.vlans     (8 tools — 5 read, 3 write)
   • extremecloudiq.ssids     (11 tools — 6 read, 5 write)
   • ... (11 more)

Domain intelligence populated:
   • 47 documentation pages indexed
   • Entity graph: Client → AP → Location, VLAN → Policy
   • 4 analysis playbooks generated

Publish all 15 skills to the registry? [Approve / Deny]
```

Tap **Approve**.

---

## Part 4 — Assign Skill and Credential to Agent

1. Go to **Agents → your XIQ agent → Edit**
2. **Skills tab**: Add all `extremecloudiq.*` skills
3. **Credentials tab**: Assign `XIQ Production`
4. **Charter tab**: Set posture to `SUPERVISED` (approval for writes)
5. Click **Save**

---

## Part 5 — Test the Agent

Set the new agent as active in the Nexus chat, then test:

```
List all devices
```

Expected:
```
Found 47 devices:

| Hostname              | Status | Model   | IP         |
|-----------------------|--------|---------|------------|
| Beverly-Main-AP5010   | Online | AP5010  | 10.1.1.5   |
| Beverly-Main-AP5010-B | Online | AP5010  | 10.1.1.6   |
| FrontAP3000           | Online | AP3000  | 10.1.2.1   |
...
```

### Complex Query — Radio Quality by Location

```
Show me radio quality broken down by location
```

Because the query contains "radio" and "quality" and "location", the **radio-quality-by-location** playbook is automatically injected into the agent's context. The agent follows the step-by-step workflow:

```
1. Fetching all locations...
2. For each location, fetching associated APs...
3. Fetching radio statistics per AP...
4. Aggregating by location...

Radio Quality by Location:

| Location          | APs | Avg Signal | Interference | Clients |
|-------------------|-----|-----------|--------------|---------|
| Beverly Main      | 8   | -58 dBm   | Low          | 42      |
| Front Office      | 3   | -62 dBm   | Medium       | 18      |
| Warehouse         | 2   | -71 dBm   | High         | 5       |
```

### Complex Query — VLAN to IP Range Mapping

```
Map all VLANs to their IP ranges
```

The **vlan-ip-range-mapping** playbook triggers (words: "vlan", "ip", "ranges") and guides the multi-step lookup:

```
| VLAN ID | Name          | IP Range        | Gateway      |
|---------|---------------|-----------------|--------------|
| 1       | Default       | 10.1.0.0/24     | 10.1.0.1     |
| 100     | Corporate     | 10.1.100.0/24   | 10.1.100.1   |
| 200     | IoT Devices   | 10.1.200.0/24   | 10.1.200.1   |
| 300     | Guest         | 192.168.1.0/24  | 192.168.1.1  |
```

---

## Part 6 — Configure Write Approvals

```
Create a new VLAN called "IoT Devices" with VLAN ID 200
```

Because the agent's charter posture is `SUPERVISED`, write operations require approval:

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
```

---

## Part 7 — Set Up Hourly Monitoring

1. Go to **Scheduled → New Job**
2. Set:
   - **Agent**: your XIQ monitoring agent
   - **Schedule**: `0 * * * *`
   - **Message**: `Check for critical alarms and disconnected APs. If nothing changed, start your response with [NO_CHANGE].`
3. Save

The `[NO_CHANGE]` signal tells the scheduler to skip Telegram notifications and skip writing to agent memory when nothing needs attention — preventing alert fatigue.

When issues are found:
```
🔴 XIQ Alert — 2 issues found:

1. AP "FrontAP3000" has been offline for 47 minutes
   Proposed fix: ping device, check PoE switch port

2. SSID "Guest" has high interference on channel 6 (14 APs affected)
   Proposed fix: run auto-channel optimisation

Request remediation with approval? [Yes / No]
```

---

## Part 8 — Agent Memory (Known Clients Tracking)

The agent's `memory.md` persists across scheduled runs. Over time it accumulates context like:

```
## Known Clients (as of 2026-05-01)
- DESKTOP-ABC123 (aa:bb:cc:dd:ee:ff) — usually on FrontAP3000
- iPhone-Brian (10.1.1.42) — usually on Beverly Main
- New device joined 2026-04-30: Samsung-TV (cc:dd:ee:ff:00:11) on VLAN 200
```

The **new-device-detection** playbook helps the agent compare current client lists against memory to identify genuinely new devices vs. known regulars.

---

## Summary

| Component | Status |
|---|---|
| XIQ credentials | ✅ Stored encrypted in vault |
| Persona + agent | ✅ Generated from goal, active |
| 15 XIQ skill domains | ✅ Published to registry |
| Domain intelligence | ✅ Doc index + entity graph + 4 playbooks |
| Write operation approval gate | ✅ SUPERVISED posture |
| Hourly monitoring job | ✅ Scheduled with [NO_CHANGE] support |

---

## What to Try Next

```
# Configuration queries
Show me the configuration of SSID "Corporate"
List all VLANs
Show device details for FrontAP3000

# Complex domain intelligence queries
Show radio quality by location
Map VLAN IDs to IP ranges and subnets
Give me a client health overview
Show new devices that joined this week

# Client analysis
Which clients have been connected for more than 24 hours?
Show me all clients with signal strength below -80dBm
List all iPhones across all APs

# Configuration changes (will prompt for approval)
Update the "Guest" SSID password
Add a new AP to the "Branch Office" network policy
Create a new SSID for IoT devices on VLAN 200

# Monitoring
Are there any active critical alarms right now?
Show me device uptime statistics for the last 7 days
```

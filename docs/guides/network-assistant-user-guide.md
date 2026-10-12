# BEX Network Assistant — User Guide

A practical guide to operating your network using natural language. This document covers everything from asking your first question to building autonomous monitoring agents, creating new skills from internet documentation, and publishing live dashboards.

Every command in this guide has been verified against a live BEX instance.

---

## Table of Contents

1. [Why BEX is Different](#1-why-bex-is-different)
2. [Talking to the System](#2-talking-to-the-system)
3. [Questions Beyond Standard NMS Tools](#3-questions-beyond-standard-nms-tools)
4. [Correlating Information Across Systems](#4-correlating-information-across-systems)
5. [Creating New Skills from Internet Sources](#5-creating-new-skills-from-internet-sources)
6. [Playbooks — Scheduled Monitoring](#6-playbooks--scheduled-monitoring)
7. [Monitoring Personas — Autonomous Network Watchers](#7-monitoring-personas--autonomous-network-watchers)
8. [Network Operations — Making Changes](#8-network-operations--making-changes)
9. [Dashboard Creation](#9-dashboard-creation)
10. [Verified Command Reference](#10-verified-command-reference)

---

## 1. Why BEX is Different

Standard network management AI tools answer questions about configuration — they are wrappers around a single vendor's own interface and can only surface what that interface already shows you.

BEX is different in four ways:

| Capability | Standard NMS AI | BEX |
|---|---|---|
| Answers questions about network data | ✅ (one platform only) | ✅ (multi-platform) |
| Correlates data across two systems | ❌ | ✅ XIQ + XCO together |
| Remembers previous answers in context | ❌ | ✅ conversation history |
| Learns new API skills from documentation | ❌ | ✅ skill builder |
| Creates autonomous monitoring agents | ❌ | ✅ personas + scheduler |
| Makes config changes with approval gate | ❌ | ✅ write tools + permission gateway |
| Creates live dashboards from a sentence | ❌ | ✅ widget generator |

The underlying principle: BEX translates natural language → API calls → structured response, using an LLM to reason about what to ask and how to interpret it. When a required skill doesn't exist, it builds one from documentation and adds it permanently.

---

## 2. Talking to the System

### Interfaces

| Interface | How to use |
|---|---|
| **Telegram** | Send a message to the bot. Plain text goes to your default agent (XIQ Monitor). `@bex` goes to the Nexus system management agent. |
| **Dashboard chat** | Click the chat icon on any dashboard page. Responses appear inline. |
| **Nexus (GUI)** | The browser-based assistant at the top of the admin dashboard. |
| **REST API** | `POST /requests` with `{ agentId, input, channel: "api" }` |

### Which agent handles what?

BEX uses multiple specialist agents. Messages are routed based on which agent is selected or active.

| Agent | What it handles |
|---|---|
| **ExtremeCloud IQ Monitor** | All wireless questions — APs, clients, SSIDs, VLANs, policies, reports |
| **XCO Monitor** | Data centre fabric — switches, BGP, fabrics, alarms, VTEP |
| **XCO Operator** | Same as XCO Monitor + write operations (requires approval for writes) |
| **Nexus** (`@bex` prefix) | System management — scheduled jobs, credentials, agent status, skill inventory |

### The `@bex` prefix

Use `@bex` **only** for managing BEX itself:

```
@bex system status
@bex show me all scheduled jobs
@bex pause all scheduled jobs
@bex has the XIQ credential been configured?
@bex what skills are currently published?
@bex what is the status of the XCO Operator agent?
```

Do **not** use `@bex` for data queries (devices, clients, fabric, alarms). Those go directly to the appropriate agent without any prefix.

---

## 3. Questions Beyond Standard NMS Tools

This section shows the kinds of questions BEX answers that standard NMS interfaces cannot — multi-step reasoning, named-client context awareness, cross-SSID correlation, and quality interpretation.

### 3.1 Named Client Context

BEX remembers which clients you've been discussing and carries context forward. You can refer to devices by name.

```
Give me a snapshot of the iPhone — current AP, SSID, IP, and signal
```

**Example response:**
```json
{
  "client_name": "iPhone",
  "current_status": {
    "connected_ap": "Beverly Main AP5010",
    "ssid": "B13-Home",
    "ip_address": "10.0.250.102",
    "signal_quality": { "snr": 36, "rssi": -56 }
  },
  "vlan": 250,
  "radio": "5G",
  "wifi_protocol": "802.11ax-5g",
  "channel": 36
}
```

Follow-up (no need to repeat the client name):
```
Show me its connection history for the last 2 hours
```
```
Which APs has it roamed between today?
```

### 3.2 Client Quality Analysis

```
Show all clients with poor signal quality
```
```
Give me a health report for all wireless clients sorted by signal quality
```
```
Show all Apple clients on all access points with their Hostname, IP Address, VLAN and SSID
```
```
Show all Android clients currently connected
```

### 3.3 AP / Network Topology

```
Which AP has the most clients connected?
```

**Example response:** *"The AP with the most clients connected is Beverly Main AP5010, with 3 clients."*

```
List all access points with their status
```
```
Which APs are currently offline?
```
```
Show me the radio quality metrics for all APs
```

### 3.4 SSID / VLAN Correlation

This is a multi-step query — BEX fetches VLANs, fetches active clients, and cross-references them:

```
Show me all SSIDs and their assigned VLANs
```

**Example response:**
```
1. SSID: B13-Home  →  VLAN 250 (LAN_HOME_250)  — 16 clients
2. SSID: PoxieMoxie  →  VLAN 1  — 23 clients
3. SSID: OfficeLaan  →  VLAN 1  — 2 clients
4. SSID: Enterprise  →  VLAN 100
```

```
Who is connected to the "B13-Home" SSID right now?
```
```
Show me the full topology — which SSIDs are on which VLANs and how many clients are connected to each
```

### 3.5 Network Policy Inspection

```
What network policies are currently defined?
```

**Example response:**
```
1. TestLab — Switches and APs in Office Lab (Network Access and Switching)
2. Beverly — Wireless Access
3. Test-Extreme — Setup for ExtremeLabs in Paris (Wireless Access)
```

```
Show the VLAN assigned to the "Beverly" policy
```
```
List all user profiles and their VLAN mappings
```

### 3.6 Connectivity Anomalies (Copilot AI)

```
Are there any connectivity anomalies detected by Copilot?
```
```
Show me the client health dashboard
```
```
Show me the wireless usage and capacity dashboard
```

### 3.7 XCO Fabric Intelligence

```
Show me all devices registered in XCO
```
```
Show me all IP fabrics and their status
```

**Example response:**
```json
{
  "fabrics": [
    { "fabric_name": "default", "fabric_type": "clos", "fabric_health": "Green" },
    { "fabric_name": "fs1", "fabric_type": "clos", "fabric_health": "Green" }
  ]
}
```

```
Are all fabric switches reachable?
```
```
Show me all active alarms in XCO
```
```
Show me the system health of the XCO platform
```

---

## 4. Correlating Information Across Systems

BEX can reason across both XIQ (wireless) and XCO (fabric) in a single conversation. Switch between agents or ask a cross-platform summary question.

### 4.1 End-to-End Network Health

Ask the XIQ agent for wireless health, then switch to XCO for the fabric:

```
Show me a summary of all wireless clients with poor connectivity
```
*(On XIQ agent)*

Then switch to the XCO agent:
```
Show me all active alarms in XCO and which devices they affect
```
```
Are there any devices with config drift in XCO?
```

### 4.2 Tracing from Client to Fabric

1. Find a client and which AP it's on:
   ```
   Show me the iPhone's current connection details
   ```

2. Find which switch the AP is uplinked to:
   ```
   Show me the LLDP neighbours for Beverly Main AP5010
   ```

3. Check the switch health in XCO:
   ```
   Show me the device health for SLX-30
   ```

### 4.3 Correlating Alarms with Device State

```
Show me all active alarms in XCO
```
Then:
```
Which of those devices are currently showing as degraded?
```
Then:
```
Show me the fabric health for the fabric those devices belong to
```

### 4.4 Full Network Digest

This prompt asks for a combined summary from both platforms:

```
Summarise the health of the entire network — APs, clients, fabric, and alarms
```

---

## 5. Creating New Skills from Internet Sources

When BEX encounters a question it cannot answer (no matching skill), it can **build a new skill** by reading API documentation from a URL, generating tool definitions, testing them, and publishing the skill permanently.

### How Skill Building Works

```
User: "Show me all firmware upgrade schedules in XIQ"
BEX: "I don't have a skill for this. Would you like me to build one from the XIQ API docs?"
User: "Yes — use https://developer.extremecloudiq.com/api-explorer"
BEX: Fetches docs → extracts endpoints → generates tool definitions → tests → publishes
```

### Step-by-Step: Building a Skill

#### Via the Dashboard (Admin → Skills → Build)

1. Navigate to **Skills → Build New Skill**
2. Enter a **domain** (e.g. `extremecloudiq.firmware`)
3. Enter an **intent** describing what the skill does:
   ```
   List and manage scheduled firmware upgrades for ExtremeCloud IQ devices
   ```
4. Paste one or more **documentation URLs**:
   ```
   https://developer.extremecloudiq.com/api-explorer
   https://docs.extremecloudiq.com/firmware
   ```
5. Click **Build** — the system fetches the docs, parses API schemas, and generates the skill
6. Review the generated tools, then click **Test** to validate them
7. Click **Publish** to make the skill available to agents

#### Via API

```bash
POST /skills/build
{
  "domain": "extremecloudiq.firmware",
  "intent": "List and manage scheduled firmware upgrades",
  "sources": [
    { "url": "https://developer.extremecloudiq.com/api-explorer", "type": "openapi" }
  ]
}
```

### What Makes a Good Skill Source

| Source type | Example URL | Notes |
|---|---|---|
| OpenAPI / Swagger | `https://api.example.com/openapi.json` | Best — full schema with parameters |
| Developer docs | `https://docs.example.com/api-reference` | Good — BEX discovers linked pages |
| API explorer | `https://developer.example.com/explorer` | Good |
| PDF guide | Upload via dashboard | For vendor PDFs without public URLs |

### Example: Adding a Third-Party Weather API Skill

```bash
POST /skills/build
{
  "domain": "weather.current",
  "intent": "Get current weather conditions and forecasts for any location",
  "sources": [
    { "url": "https://open-meteo.com/en/docs", "type": "url" }
  ]
}
```

After publishing, ask:
```
What is the current weather in London?
```
BEX will call Open-Meteo and format the response — no code required.

### Sharing Skills Across Instances

Once a skill is working, publish it to the registry:

```
@bex publish the extremecloudiq.firmware skill to the registry
```

Or via API:
```bash
POST /skills/{skillId}/publish-to-registry
```

Other BEX instances can install it:
```bash
POST /registry/install/extremecloudiq.firmware/1.0.0
```

---

## 6. Playbooks — Scheduled Monitoring

A **playbook** is a scheduled agent request that runs automatically on a cron expression. The agent executes the request, interprets the result, and can escalate if it finds a problem.

### Creating a Playbook via Telegram

```
@bex create a daily health check at 7am — summarise all offline APs and any active alarms
```

BEX creates a ScheduledJob that:
- Runs at `0 7 * * *`
- Sends "Summarise all offline APs and any active alarms" to the XIQ + XCO agents
- Delivers the result to your Telegram chat

### Creating a Playbook via Dashboard

1. Go to **Scheduled Jobs → New Job**
2. Set the **cron expression**: `0 7 * * *` (daily at 7am)
3. Set the **agent**: ExtremeCloud IQ Monitor
4. Set the **input** (the question to ask):
   ```
   Show me all offline APs and any clients with poor signal quality. Flag any APs that have been offline for more than 30 minutes.
   ```
5. Enable and save

### Useful Playbook Examples

| Schedule | Agent | Question |
|---|---|---|
| Every 30 mins | XIQ Monitor | `Are there any APs that have just gone offline? If so, list them with their location.` |
| Daily at 6am | XCO Monitor | `Show me all active alarms in XCO. Are there any critical alarms outstanding?` |
| Every hour | XIQ Monitor | `Show all clients with poor signal quality. If count > 10 flag this as urgent.` |
| Weekly Monday 8am | XIQ Monitor | `Show network scorecard for the last 7 days. Summarise the overall health trend.` |
| Daily at midnight | XCO Monitor | `Are there any devices with config drift in XCO? List what changed.` |

### Managing Playbooks

```
@bex show me all scheduled jobs
```
```
@bex pause all scheduled jobs
```
```
@bex resume the daily health check job
```
```
@bex run the alarm check job now
```

---

## 7. Monitoring Personas — Autonomous Network Watchers

A **persona** is a goal-based agent configuration. You describe what you want the agent to monitor in plain English — the LLM generates a complete, ready-to-deploy agent with the right system prompt, skills, and schedule.

### Creating a Persona

#### Via Dashboard (Admin → Personas → Generate)

Enter a natural language **goal**. Examples:

```
Monitor ExtremeCloud IQ for access points that go offline. When an AP goes offline, 
find all clients that were connected to it, check if they reconnected to a neighbour 
AP, and send a summary to Telegram.
```

```
Watch the XCO fabric for configuration drift. Run every hour. If drift is detected 
on any device, list exactly what changed, determine the severity, and escalate 
critical changes for approval before any remediation.
```

```
Monitor all wireless clients for poor signal quality. If more than 5 clients have 
SNR below 20dB on the same AP at the same time, raise an alert and suggest whether 
the issue is the AP or the clients.
```

```
Act as a guest network watchdog. Every 15 minutes, check all clients on the Guest 
SSID. If any client has been connected for more than 4 hours, flag it. If the same 
MAC address appears on both Guest and Corporate SSIDs, escalate immediately.
```

```
Create a fabric health guardian for the XCO data centre. Every 30 minutes: check 
all switch health, validate fabric topology, check BGP session counts. If any switch 
shows degraded health or BGP peer count drops below expected, raise a critical alert.
```

#### What Persona Generation Produces

For the AP monitoring example above, BEX generates:

| Field | Generated value |
|---|---|
| Name | `AP Availability Monitor` |
| System prompt | Detailed operational rules, escalation criteria, response format |
| Required skills | `extremecloudiq.devices`, `extremecloudiq.clients`, `extremecloudiq.composite` |
| Permissions | `read:network` |
| Schedule | `*/5 * * * *` (every 5 minutes) |
| Knowledge docs | `instructions.md`, `context.md`, `memory.md` auto-created |

#### Spawning the Agent

After generating the persona, click **Spawn Agent**. This creates a live, active agent configured exactly to the persona spec. The scheduled job starts automatically.

### Persona Examples by Use Case

#### Security Monitoring
```
Monitor the wireless network for new device types that have never been seen before. 
When a new device OS type appears (e.g. first IoT device, first Linux client), 
log it and send a notification with the device MAC, hostname, SSID, and signal quality.
```

#### Capacity Planning
```
Collect client counts per AP every hour. Build a weekly trend. If any AP consistently 
hits more than 30 clients, recommend it as a candidate for adding a second AP nearby.
```

#### SLA Monitoring
```
Monitor the ExtremeCloud IQ network scorecard. If the client success rate drops below 
95% or the average onboarding time exceeds 5 seconds, send an alert with the top 3 
contributing APs.
```

#### Fabric Change Detection
```
After every XCO config change, capture what changed, which device, and who made the 
change. Store this in memory. Weekly, produce a change log summary.
```

---

## 8. Network Operations — Making Changes

BEX supports write operations through the XCO Operator and XIQ agents. All write operations that affect live infrastructure require approval through the Permission Gateway before execution.

### How Write Operations Work

```
1. You request a change in natural language
2. BEX reads the current state
3. BEX describes exactly what it will change
4. BEX sends an approval request (Telegram / Teams notification)
5. You approve (or deny) the change
6. BEX executes the approved operation
7. BEX verifies the change was applied
```

### 8.1 Creating a New Network Policy with SSIDs

Ask the XIQ agent (with write permissions):

```
Create a new network policy called "Guest-WiFi" with a WPA2-PSK SSID named "Guest" 
on VLAN 200. Set the password to a secure random value and give it a 1 hour session 
timeout.
```

BEX will:
1. Check if "Guest-WiFi" policy already exists
2. Describe the policy it will create (SSID name, VLAN, security mode)
3. Send you an approval request via Telegram
4. Create the policy and SSID after approval
5. Confirm the policy was created and show you the SSID details

### 8.2 Assigning a Policy to Access Points

```
Assign the "Beverly" network policy to all APs at the Beverly location
```

```
Assign the "Guest-WiFi" policy to FrontAP3000 and Office AP5020
```

BEX will list the APs that will be affected and request approval before making changes.

### 8.3 Changing SSID Security

```
Change the PSK password for the "B13-Home" SSID to a new secure password
```

```
Enable 802.1x authentication on the "Enterprise" SSID
```

### 8.4 XCO Operations

```
Acknowledge all warning-level alarms in XCO
```
*(Requires XCO Operator agent — sends approval request before acknowledging)*

```
Register a new switch with IP 10.64.160.50 in the default fabric
```
*(Approval required — destructive operation)*

### 8.5 Checking if a Change Took Effect

After any operation, verify it:

```
Show me the current network policy assigned to FrontAP3000
```
```
Show me the current SSID list for the Beverly policy
```
```
Show all alarms in XCO — are there any unacknowledged warnings?
```

---

## 9. Dashboard Creation

Dashboards are created by pasting a prompt into the "Create Dashboard" form in the admin dashboard. The system calls the assigned agent, interprets the response, and renders a multi-widget dashboard that auto-refreshes.

### 9.1 Client Health Dashboard

**Prompt:**
```
Create a client health dashboard. Show all clients sorted by signal quality with a 
status indicator (good/fair/poor). Include AP name, SSID, VLAN and IP for each client.
```

**Widgets generated:**
- Headline: total client count + % with good signal
- Table: all clients with columns — Hostname, AP, SSID, VLAN, IP, SNR (dBm), Rating
- Chart: client count by signal quality band

---

### 9.2 AP Radio Quality Dashboard

**Prompt:**
```
Create an RF quality dashboard. Show a table of all APs with their SNR, noise floor, 
TX power and channel. Highlight any APs with SNR below 20dB. Include a bar chart 
showing client count per AP.
```

**Widgets generated:**
- Table: AP name, MAC, SNR, Noise Floor, TX Power, Channel, Client Count (rows with low SNR highlighted)
- Bar chart: client count per AP
- Stat: number of APs with SNR below threshold

---

### 9.3 XCO Fabric Health Dashboard

**Prompt:**
```
Create a fabric health dashboard showing all IP fabrics with their status, device 
count, alarm count, and config sync state. Flag any fabrics with errors. Include the 
XCO topology as a Mermaid diagram.
```

**Widgets generated:**
- Table: Fabric name, type, stage, health status, device count
- Mermaid diagram: spine/leaf topology rendered as `graph LR`
- Stat: alarm count by severity
- Headline: overall fabric health (Green/Amber/Red)

---

### 9.4 Policy → AP → Client Sankey Diagram

**Prompt:**
```
Show a Sankey diagram of the flow from Network Policies → SSIDs → Access Points → 
Clients. Include a summary table showing total clients per policy and per AP.
```

**Widgets generated:**
- Sankey diagram (Mermaid `sankey-beta`): Policy → SSID → AP → Client distribution
- Table: AP name, policy, client count, top SSID

---

### 9.5 Combined Network Operations Dashboard

**Prompt:**
```
Create a full network operations dashboard: 
- Section 1: all XIQ APs with client count and radio quality
- Section 2: XCO fabric health and active alarm summary  
- Section 3: top 10 clients by connection time with AP and SSID
```

---

### Dashboard Tips

- Dashboards **auto-refresh** — open a dashboard and it updates every 30 seconds
- Each dashboard is linked to a specific agent. Make sure you select the right agent when creating it (XIQ for wireless, XCO for fabric)
- Use the **Display Types** guide (click "Display Types" in the new dashboard form) to see available widget types: headline, stat, table, chart, mermaid, markdown
- You can create **multiple dashboards** for different audiences (NOC, management, security team)

---

## 10. Verified Command Reference

All commands below were tested against a live BEX instance and returned valid data.

### ExtremeCloud IQ — Client Queries

| Command | Notes |
|---|---|
| `List all access points with their status` | Returns all APs with Connected/Disconnected state |
| `Show all clients currently connected` | Full client list with MAC, IP, SSID, OS type |
| `Which APs are currently offline?` | Filtered device list, offline only |
| `Show me the radio quality metrics for all APs` | SNR, RSSI, noise floor per radio |
| `List all Apple clients on all APs with Hostname, IP, VLAN and SSID` | Vendor-filtered, multi-field |
| `Show all Android clients currently connected` | OS-filtered client list |
| `Give me a snapshot of the iPhone — current AP, SSID, IP, and signal` | Named client context lookup |
| `Show me the connection status for [client name]` | Client-specific, use real hostname |
| `Show all clients with poor signal quality` | Quality-classified client report |
| `Give me a health report for all wireless clients` | Full quality + AP + SSID matrix |

### ExtremeCloud IQ — AP / Network

| Command | Notes |
|---|---|
| `Which AP has the most clients connected?` | Single answer with count |
| `Show me all SSIDs and their assigned VLANs` | Multi-step: VLANs + client count |
| `What network policies are currently defined?` | Policy inventory with type |
| `Show me all active alarms in XCO` | Alarm list with severity |
| `Are there any connectivity anomalies detected by Copilot?` | Copilot AI anomaly check |
| `Show me the wireless usage and capacity dashboard` | Usage metrics per SSID/AP |
| `Show network scorecard for the last 7 days` | Requires location context — say "for Beverly" |

### XCO — Fabric

| Command | Agent | Notes |
|---|---|---|
| `Show me all devices registered in XCO` | XCO Monitor | Switch inventory |
| `Show all IP fabrics and their status` | XCO Monitor | Fabric list with health |
| `Show me all active alarms in XCO` | XCO Monitor | Active alarm list |
| `Show me the system health of the XCO platform` | XCO Monitor | K8s service features |
| `Are there any devices with config drift in XCO?` | XCO Monitor | Config validation |
| `Show me the XCO network topology as a Mermaid diagram` | XCO Monitor | `graph LR` diagram |

### System Management (use `@bex` prefix)

| Command | Notes |
|---|---|
| `@bex system status` | Agent + service status |
| `@bex show me all scheduled jobs` | Cron job inventory |
| `@bex has the XIQ credential been configured?` | Returns yes/no + status |
| `@bex has the XCO credential been configured?` | Returns yes/no + status |
| `@bex pause all scheduled jobs` | Suspends all cron jobs |
| `@bex resume [job name]` | Re-enables a specific job |
| `@bex what skills are currently published?` | Skill inventory |

### Skill Generation Triggers
> These commands should trigger the skill discovery pipeline if no matching skill exists

| Command |
|---|
| `Show me all scheduled wireless firmware upgrades` |
| `List all client roaming events in the last hour` |
| `Show me the RF channel utilisation heatmap across all APs` |
| `List all VRF definitions in the fabric` |
| `What WPA3 clients are connected right now?` |
| `Pull all IoT devices connected to the guest SSID` |

---

## Appendix: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────────┐
│  BEX Quick Reference                                                │
├─────────────────────────────────────────────────────────────────────┤
│  Wireless queries    → plain text (XIQ Monitor agent)               │
│  Fabric queries      → switch to XCO Monitor agent                 │
│  System management  → @bex prefix (Nexus agent)                    │
│                                                                     │
│  Context carries forward — refer to clients by name                │
│  Multi-step questions work — BEX chains API calls automatically    │
│  Unknown skill?  BEX can build one from a docs URL                 │
│  Monitoring?     Create a persona with a cron schedule             │
│  Make a change?  Always gets an approval gate before executing     │
└─────────────────────────────────────────────────────────────────────┘
```

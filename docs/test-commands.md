# BEX Test Commands

A reference of natural-language queries to exercise the platform end-to-end.
Send via Telegram, the Dashboard chat, or directly against the REST API.

## When to use `@bex` (Nexus)

`@bex` routes your message to the **Nexus** system management agent. Use it **only** for managing the BEX platform itself:

| Use `@bex` for… | Don't use `@bex` for… |
|---|---|
| Viewing/managing scheduled jobs | Querying devices, clients, APs |
| Checking/pausing/resuming agents | Network health or alarms |
| Verifying credentials are configured | Fabric, VLAN, BGP state |
| Listing available skills | Any live network data |
| System status & version | Dashboard creation |

> **Note:** `NEXUS_AGENT_ID` must be set in `.env` to enable a dedicated Nexus agent.
> Without it, `@bex` falls back to the default XIQ agent.

---

## 1. System Management (Nexus — use `@bex` prefix)
> Send with `@bex` prefix. These are genuine management/admin operations.

```
@bex system status
@bex show me all scheduled jobs
@bex pause all scheduled jobs
@bex resume the XIQ Monitor scheduled job
@bex has the XIQ credential been configured?
@bex has the XCO credential been configured?
@bex what capabilities does the XIQ agent have?
@bex what XIQ skills are currently published?
@bex list all ExtremeCloud Orchestrator skills
@bex what is the current status of the XCO Operator agent?
@bex show the XCO Monitor agent's skill inventory
```

---

## 2. XIQ Agent — Direct Questions
> Send without `@bex` prefix (routes to default XIQ agent). Tests the XIQ skill set end-to-end.

### Clients
```
List all Apple clients on all access points with their Hostname, IP Address, VLAN and SSID
Show all Android clients currently connected
Who is connected to the "Corporate" SSID right now?
Show me the connection status for BonePhone
Find all clients connected to the Guest network
Show all clients with poor signal quality
Give me a snapshot of Brendan's iPhone — current AP, SSID, IP, and signal
```

### Access Points / Devices
```
List all access points with their status
Which APs are currently offline?
Show me the radio quality metrics for all APs
Show radio quality for 5GHz radios only
Which AP has the most clients connected?
Show device health for all APs
```

### VLANs / Network Policy
```
Show me all SSIDs and their assigned VLANs
What network policies are currently defined?
Show the VLAN assigned to the "Staff" SSID
List all user profiles and their VLAN mappings
```

### Monitoring / Reports
```
Show me the wireless usage and capacity dashboard
Show network scorecard for the last 7 days
Are there any connectivity anomalies detected by Copilot?
Show me the client health dashboard
```

---

## 3. XCO Agent — Direct Questions
> Tests the XCO Monitor and Operations skill sets end-to-end.

### Inventory & Health
```
Show me all devices registered in XCO
What is the current health of the IP fabric?
Are all fabric switches reachable?
Show me any devices that are out of sync with their config
Show me the system health of the XCO platform
```

### Alarms & Events
```
Show me all active alarms in XCO
What alarms have been raised in the last 24 hours?
Show me the event log for PROD-DC1
Are there any critical alarms outstanding?
Show me the full alarm history for the fabric
```

### Fabric & Topology
```
List all IP fabrics and their status
Show me the details of the PROD-DC1 fabric
Are there any fabric errors or validation failures?
Show BGP session state for all leaf switches
Show me all LLDP neighbours in the fabric
Show interface utilisation across all fabric links
Show VTEP endpoints for the overlay fabric
```

### Diagnostics
```
Show me the interface status for all spine switches
Check BGP sessions on the spine layer
Show the switch config for the core spine
Run a fabric health validation and report any issues
```

### Telemetry
```
Show me device telemetry for the last hour
Show interface utilisation trends for the fabric uplinks
What is the current fabric-wide bandwidth utilisation?
```

---

## 4. Skill Generation Questions
> Questions that should trigger the skill discovery pipeline when no matching skill exists. The system should generate a new skill, run tests, and present it.

```
Show me all scheduled wireless firmware upgrades
List all client roaming events in the last hour
Show me the RF channel utilisation heatmap across all APs
Pull the ExtremeCloud IQ network scorecard for this week
Show me all SSIDs with client isolation enabled
List all XCO tenants and their fabric assignments
Show me all VRF definitions in the fabric
What WPA3 clients are connected right now?
Show me the co-channel interference score per AP
Pull all IoT devices connected to the guest SSID
```

---

## 5. Dashboard Creation Queries
> Paste these directly into the "Create Dashboard" prompt in the dashboard UI. Each should result in a multi-widget dashboard.

### Apple / Client Dashboards
```
List all Apple clients on all access points, and present each AP with the Hostname, IP Address, VLAN and SSID. In the next section, show all Devices in a line chart by Radio Parameter Quality.
```

```
Show a dashboard of all wireless clients grouped by vendor (Apple, Android, Windows). For each vendor show client count, average signal quality, and top 5 connected APs.
```

```
Create a client health dashboard. Show all clients sorted by signal quality with a status indicator (good/fair/poor). Include AP name, SSID, VLAN and IP for each.
```

```
Show me a roaming analysis dashboard — which clients have roamed more than 3 times in the last hour, and which APs are they moving between?
```

### Radio / RF Dashboards
```
Create an RF quality dashboard. Show a table of all APs with their 2.4GHz and 5GHz SNR, noise floor, TX power and channel. Highlight any APs with SNR below 20dB.
```

```
Show a radio utilisation dashboard — channel utilisation per AP per radio, sorted by most congested. Include client count per radio.
```

### XCO / Fabric Dashboards
```
Create a fabric health dashboard showing all IP fabrics with their status, device count, alarm count, and config sync state. Flag any fabrics with errors.
```

```
Show an XCO alarm dashboard. Display active alarms grouped by severity (critical/major/minor) with device name, fabric, and time raised. Include a trend chart of alarms over the last 7 days.
```

```
Create a network operations dashboard: show XCO device inventory with config state, fabric health summary, active alarm count, and BGP session status across all leaf and spine nodes.
```

```
Show the XCO network topology as a Mermaid diagram — spines, leaves and fabric links. Include a table of all switches with their role, management IP, fabric and config state.
```

### XIQ Mermaid / Sankey Dashboards
```
Show a Sankey diagram of Policies → SSID → AP → Client distribution on the XIQ account. Include a summary table showing total clients per policy and per AP.
```

### Combined / Cross-Platform Dashboards
```
Create a full network health dashboard: in section 1 show all XIQ APs with client count and radio quality; in section 2 show XCO fabric health and alarm summary; in section 3 show top 10 clients by bandwidth usage.
```

```
Show a guest network dashboard: all clients on the Guest SSID with hostname, IP, AP, signal quality, and time connected. Include a chart showing guest client count over the last 24 hours.
```

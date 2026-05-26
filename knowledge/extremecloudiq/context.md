# Extreme Networks — Platform One API Reference

## Platform Overview

Extreme Platform One is Extreme Networks' next-generation cloud management platform.
It manages Extreme access points, switches, SD-WAN appliances, and IoT devices
through a unified multi-service API hosted at `cloudapi.extremecloudiq.com`.

This document is the authoritative reference for AI agents making Platform One API calls.

---

## Authentication

Platform One uses **Bearer token** authentication. Tokens have the format `extr_sk_v1.xxx`.

- All requests: `Authorization: Bearer extr_sk_v1.xxx`
- Credential vault key: **`system.extremep1_api_token`** — field `api_token`
- Permissions required: `p1:read` (read), `p1:write` (write/mutations)
- Tokens do **not** expire the way session tokens do — they are long-lived API keys

Agents **never** handle the token directly. The `p1_http_call` handler and all composite handlers
resolve `system.extremep1_api_token` from the credential vault automatically.

---

## Service Domains and Base URLs

All services share the root domain `cloudapi.extremecloudiq.com`. Each service has its own path prefix:

| Service | Base URL | Purpose |
|---|---|---|
| XIQ (devices/clients/policies) | `https://cloudapi.extremecloudiq.com/xiq/v1` | Core device, client, and config management |
| Site | `https://cloudapi.extremecloudiq.com/site/v1` | Location hierarchy (sites, buildings, floors) |
| Alert | `https://cloudapi.extremecloudiq.com/alert/v1` | Alerts, events, alert policies |
| Network Visibility & Orchestration | `https://cloudapi.extremecloudiq.com/nvo/v1` | Topology, LLDP, VLANs, L2/L3, VRFs |
| Performance Management | `https://cloudapi.extremecloudiq.com/pm/v1` | Analytics, health scores, Copilot anomalies |
| Client Service | `https://cloudapi.extremecloudiq.com/client/v1` | Wireless/wired client grid queries |
| IAM | `https://cloudapi.extremecloudiq.com/iam/v1` | Users, roles, API keys, organizations |
| Audit Log | `https://cloudapi.extremecloudiq.com/auditlog/v1` | User activity audit trail |
| Asset / DLCS | `https://cloudapi.extremecloudiq.com/assets/v1` | Inventory, firmware, lifecycle, subscriptions |
| Device Lifecycle | `https://cloudapi.extremecloudiq.com/device-lifecycle` | Device serial/MAC lookup (DLCS) |
| Notifications | `https://cloudapi.extremecloudiq.com/notification/v1` | Email, webhooks, ServiceNow rules |
| Tagging | `https://cloudapi.extremecloudiq.com/tagging/v1` | Tag definitions and entity associations |
| Metastore | `https://cloudapi.extremecloudiq.com/metastore/v1` | Events, event types/severities |
| SD-WAN | `https://cloudapi.extremecloudiq.com/sdwan` | SD-WAN sites, appliances, WAN monitoring |

---

## Skill Domains

Skills are grouped by service domain. Each skill has a `domain` identifier and a set of tools
built with the `p1_http_call` handler type (or a composite handler for multi-step operations).

| Domain | Skills |
|---|---|
| `extremep1.devices` | Device lifecycle, radio info, firmware, location assignment |
| `extremep1.clients` | Wireless/wired clients, usage, OUI lookup, disconnect |
| `extremep1.sites` | Site/building/floor hierarchy, location tree |
| `extremep1.alerts` | Alerts, events, alert policies, acknowledge/clear |
| `extremep1.monitoring` | Analytics, health scores, Copilot anomaly detection |
| `extremep1.topology` | Network topology, LLDP, VLANs, L2/L3 services |
| `extremep1.configuration` | Network policies, SSIDs, VLANs, RADIUS, radio profiles |
| `extremep1.iam` | Users, roles, groups, API keys, organizations |
| `extremep1.audit` | User activity, audit log export |
| `extremep1.assets` | Device inventory, firmware summary, hardware lifecycle |
| `extremep1.notifications` | Email, webhooks, ServiceNow, routing rules |
| `extremep1.tagging` | Tag CRUD, entity associations |
| `extremep1.sdwan` | SD-WAN sites, appliances, WAN monitoring |
| `extremep1.composite` | Multi-step intelligence tools (preferred entry point) |

---

## How Skill Tools Work

### `p1_http_call` handler

Raw API tools use `handlerType: 'p1_http_call'` with config:
- `method`: HTTP verb (`GET`, `POST`, `PUT`, `DELETE`)
- `urlTemplate`: Full URL with `{param}` substitutions, e.g. `https://cloudapi.extremecloudiq.com/xiq/v1/devices/{id}`
- `isWrite`: `true` for mutations — requires human approval before execution
- `credential`: resolved from `system.extremep1_api_token` automatically

The handler injects `Authorization: Bearer <token>` on every request.
Path parameters like `{id}` are substituted from the tool call arguments.
Query parameters are appended as `?key=value` pairs.
Request body (for POST/PUT) is sent as JSON.

### Composite handlers

Composite tools use specialized `handlerType` values and perform multi-step
API sequences internally. They are the **preferred** entry point for agent queries
because they handle all required API chaining automatically.

---

## Composite Tools — Platform One (`extremep1.composite`)

Always prefer these over raw API calls when the query is covered.

### `p1_clients_by_vendor`
**Handler:** `p1_clients_by_vendor`

Lists active wireless clients filtered by vendor/OS using three detection signals:
1. `os_type` field (e.g. `Apple iOS`, `macOS`, `Android`, `Windows`)
2. Hostname pattern matching (e.g. `iPhone`, `MacBook`, `iPad`)
3. MAC OUI lookup against known vendor prefixes

Parameters:
- `vendor` — `"apple"`, `"android"`, `"windows"`, `"linux"` (default: `"apple"`)
- `apName` — optional: filter to clients on APs whose hostname contains this string
- `locationId` — optional: numeric location ID

Returns: hostname, IP, VLAN, SSID, connected AP name, signal quality per client.

**Use for:** "show Apple clients", "how many iPhones are connected", "Android devices on AP-East"

### `p1_client_snapshot`
**Handler:** `p1_client_snapshot`

Full status snapshot for a single named client device.

Parameters:
- `clientName` — hostname or partial name (e.g. `"BonePhone"`, `"MacBook"`)
- `macAddress` — MAC address (use when known, required for offline history)

Returns: `is_currently_connected`, `current_connection` (AP, SSID, IP, SNR, RSSI, health_score), `last_seen_at`, `status_message` (plain English ready to report).

The `status_message` field is always ready to report verbatim:
- Connected: `"BonePhone is CONNECTED on AP-Office-1 (Corp-WiFi)"`
- Offline with history: `"BonePhone is NOT currently connected. Last seen: 2026-04-22T09:10:00Z on AP-Reception"`
- Offline no history: `"BonePhone not found. Provide macAddress to retrieve connection history."`

**Use for:** "where is John's iPhone", "is BonePhone connected", "what signal does MacBook have"

### `p1_network_health_summary`
**Handler:** `p1_network_health`

Overall network health scores for a location. Resolves location name to ID automatically.

Parameters:
- `locationName` — location name to search (e.g. `"Beverly"`, `"HQ"`, `"Building A"`)
- `locationId` — numeric location ID (use if already known)

Returns: WiFi health score, device health score, client health score, services health score.

**Use for:** "how is the network at Beverly", "show health scores", "is HQ healthy"

### `p1_device_health_summary`
**Handler:** `p1_device_health`

Device health breakdown for APs/switches at a location. Auto-resolves location name.

Parameters:
- `locationName` — location name to search
- `locationId` — numeric location ID (use if already known)

**Use for:** "show device health at main office", "which APs are unhealthy"

### `p1_topology_overview`
**Handler:** `p1_topology_report`

Full network topology with SSID → VLAN → Client mapping.
Chains: `GET /network-policies` → `GET /network-policies/{id}/ssids` → `GET /user-profiles/{id}` → `GET /clients/active`

Parameters:
- `ssidFilter` — only include SSIDs containing this string
- `locationId` — optional numeric location filter

**Use for:** "show topology", "SSID to VLAN map", "what network policy covers Corp-WiFi"

### `p1_radio_quality_report`
**Handler:** `p1_radio_quality`

Radio quality metrics (channel, SNR, RSSI, noise floor, TX/RX rates) for all APs.
Handles device enumeration automatically — no need to gather device IDs first.

Parameters:
- `apNameFilter` — only APs whose hostname contains this string
- `radioType` — `"2.4GHz"`, `"5GHz"`, or `"6GHz"`

Returns: per-AP, per-radio breakdown with health classification.

**Use for:** "show radio quality", "which APs have bad SNR", "5GHz channel utilization"

### `p1_ap_client_distribution`
**Handler:** `p1_ap_client_sankey`

Client distribution across APs as a Mermaid sankey diagram:
`Access Points → SSIDs → Client Vendor → Device Type`

Parameters:
- `apFilter` — only clients on APs matching this name

Returns: `sankey_diagram` field with valid `sankey-beta` Mermaid syntax — return this field as-is
so the dashboard renders it as a Mermaid widget.

**Use for:** "what devices are on the network", "AP client breakdown", "show device type distribution"

### `p1_alert_summary`
**Handler:** `p1_alert_summary`

Comprehensive alert summary: counts by severity, top active alerts, recent events.
Calls `GET /alerts/severity-counts` + `GET /alerts` (no sortField — see gotchas).

Parameters:
- `locationId` — optional: filter alerts to a specific site
- `severities` — optional: comma-separated `CRITICAL,MAJOR,MINOR,WARNING,INFO`

**Use for:** "any alerts?", "what are the current issues?", "show active problems"

### `p1_client_health_report`
**Handler:** `p1_client_health_report`

Health report for all active wireless clients — signal quality, retry rate, health classification.
Groups clients as poor / fair / good based on SNR and RSSI thresholds.

Parameters:
- `healthFilter` — `"poor"`, `"fair"`, or `"good"`
- `apFilter` — only clients on APs matching this name

**Use for:** "show clients with poor signal", "which clients have connectivity issues", "bad radio clients"

---

## Key Operational Patterns

### Pattern: List devices

```
GET /xiq/v1/devices
  ?page=1&limit=100&connected=true&views=FULL
```

Returns `data[].id` (numeric), `mac_address`, `hostname`, `model`, `location_id`.
Always use `id` (integer) — never `mac_address` — for subsequent calls.

### Pattern: Radio quality by location

```
Step 1: p1_list_devices(locationId=<loc_id>)  → get numeric device IDs
Step 2: p1_get_devices_radio_info(deviceIds="12345,67890,11111")
Step 3: Correlate results by location/AP
```

Or use `p1_radio_quality_report` composite which does this automatically.

Note: `deviceIds` must be a **comma-separated string of integers**, not a JSON array.
Always call `p1_list_devices` first — the radio endpoint requires numeric IDs, not MACs.

### Pattern: SSID → VLAN → Client correlation

```
Step 1: GET /xiq/v1/network-policies            → policy list with IDs
Step 2: GET /xiq/v1/network-policies/{id}/ssids → SSID names + user_profile IDs
Step 3: GET /xiq/v1/user-profiles/{up_id}       → vlan_profile.id, default_vlan_id
Step 4: GET /xiq/v1/network/vlan-profiles        → VLAN name + default_vlan_id
Step 5: GET /xiq/v1/clients/active               → clients with ssid + ip_address
Step 6: Correlate SSID → VLAN → clients
```

Or use `p1_topology_overview` composite which does this automatically.

### Pattern: Get location ID before health queries

```
Step 1: GET /site/v1/tree                       → full location hierarchy
Step 2: Find site/building/floor matching name
Step 3: Use numeric locationId in health/device/client endpoints
```

Or use `p1_network_health_summary(locationName="Beverly")` — auto-resolves.

### Pattern: Device presence detection

```
1. p1_list_active_clients(searchString="BonePhone")
2. If results.length > 0 → PRESENT at results[0].connected_ap on results[0].ssid
3. If results.length = 0 → ABSENT
4. Use p1_client_snapshot with macAddress for offline history
```

---

## Critical Gotchas

### 1. NEVER pass sortField or order to `/alert/v1/alerts`

`GET /alert/v1/alerts` does **not** support `sortField` or `order` parameters.
Passing them causes `400 BAD_REQUEST`. Use `p1_alert_summary` composite instead.

Supported filters: `severities`, `categoryIds`, `startTime`, `endTime`, `keyword`, `siteId`, `buildingId`.

### 2. NEVER guess locationId

Location IDs are numeric and org-specific. Never assume a value.
Always resolve via `p1_get_location_tree` (`GET /site/v1/tree`) first,
or use a composite tool that resolves names automatically.

### 3. Radio info requires device IDs first

`GET /xiq/v1/devices/radio-information` requires `deviceIds` — a **comma-separated string of integers**.
Always call `p1_list_devices` first to get numeric IDs.
Passing MAC addresses returns `NOT_FOUND`. Passing JSON arrays returns a parse error.

### 4. searchString does NOT search vendor/manufacturer

`searchString` on client endpoints matches display name, hostname, alias, and MAC prefix only.
It does **not** search `os_type`, manufacturer, or OUI.
Use `p1_clients_by_vendor` composite tool for vendor/OS filtering.

### 5. Do NOT pass `views` to raw client list

Passing a `views` array parameter to `GET /xiq/v1/clients/active` (or the v1 XIQ list endpoint)
can cause `400` errors depending on the endpoint version.
Use the Platform One client service (`/client/v1/wireless-grid`) for rich view fields,
or use `p1_client_snapshot` composite which handles field enrichment automatically.

### 6. Write operations require approval

Any tool with `isWrite: true` in its config must receive explicit human confirmation
before execution. The bex orchestrator enforces this for the `SUPERVISED` agent posture.
Write operations include: reboot, firmware upgrade, policy push, disconnect client,
create/delete site, create/delete API key, and all CRUD mutations.

### 7. Time parameters are epoch milliseconds

All `startTime` / `endTime` parameters across all services use **epoch milliseconds** (not seconds).

```
const now = Date.now();
const last24h = now - 86_400_000;
const lastHour = now - 3_600_000;
const lastWeek = now - 604_800_000;
```

---

## Apple Device Detection (Multi-Strategy)

When detecting Apple/iOS clients, three detection signals are combined because
no single signal is reliable for all devices:

1. **`os_type` field** — matches: `Apple iOS`, `macOS`, `Mac OS X`, `iPadOS`, `watchOS`, `tvOS`
2. **Hostname pattern** — matches: `iPhone`, `iPad`, `MacBook`, `iMac`, `AirPods`, `Apple Watch`, `HomePod`
3. **MAC OUI** — first 3 octets matched against known Apple IEEE-registered OUI prefixes

**Why multi-strategy is required:**
- iOS devices with MAC randomization have unknown OUIs → `os_type` may show `Undetermined`
- A device named "BonePhone" is an iPhone but its `os_type` may be blank until XIQ fingerprints it
- `searchString="Apple"` returns zero results — it matches display names, not `os_type`

**Always use `p1_clients_by_vendor(vendor="apple")` for Apple client queries** — it applies
all three signals in a single pass and returns correctly filtered results.

---

## Pagination

All list endpoints use page/limit:
- `page` — integer, min 1
- `limit` — integer, min 1, max 100 (some endpoints max 1000)
- Always check if more pages are needed for complete data sets

The Platform One client service (`/client/v1`) uses `pageSize` instead of `limit`.

---

## Radio Quality Thresholds

| Metric | Good | Fair | Poor |
|---|---|---|---|
| SNR | >= 25 dB | 15–24 dB | < 15 dB |
| RSSI | >= -67 dBm | -68 to -80 dBm | < -80 dBm |
| Health Score | >= 70 | 40–69 | < 40 |

---

## Key Endpoint Reference (XIQ service — `/xiq/v1`)

| Endpoint | Purpose |
|---|---|
| `GET /devices` | List devices. Returns `id` (int), `mac_address`, `hostname`, `location_id` |
| `GET /devices/{id}` | Single device by numeric ID |
| `GET /devices/{id}/stats` | Real-time stats for a device |
| `GET /devices/radio-information?deviceIds=1,2,3` | Radio stats — requires comma-separated int IDs |
| `POST /devices/:reboot` | Reboot devices (WRITE — approval required) |
| `GET /clients/active` | Active wireless clients |
| `GET /clients/summary` | Aggregate client statistics |
| `GET /network-policies` | List network policies |
| `GET /network-policies/{id}/ssids` | SSIDs under a policy |
| `GET /user-profiles/{id}` | User profile with VLAN assignment |
| `GET /network/vlan-profiles` | VLAN profiles |

## Key Endpoint Reference (Site service — `/site/v1`)

| Endpoint | Purpose |
|---|---|
| `GET /tree` | Full location hierarchy (sites → buildings → floors) |
| `GET /tree/devices` | Location tree with device associations |
| `GET /sites` | List all sites |
| `GET /buildings?siteId=X` | Buildings, optionally filtered by site |
| `GET /floors?buildingId=X` | Floors in a building |
| `GET /count` | Counts of sites, buildings, floors |

## Key Endpoint Reference (Alert service — `/alert/v1`)

| Endpoint | Purpose |
|---|---|
| `GET /alerts` | List alerts — NO sortField/order params |
| `GET /alerts/severity-counts` | Alert counts by severity |
| `GET /alerts/count-by-group` | Alert counts grouped by category |
| `GET /metadata/categories` | Alert category types |
| `POST /alerts/:acknowledge` | Acknowledge alerts (WRITE) |
| `POST /alerts/:clear` | Clear/resolve alerts (WRITE) |

## Key Endpoint Reference (Monitoring — `/pm/v1`)

| Endpoint | Purpose |
|---|---|
| `GET /locations/{locationId}/wifi-health` | WiFi health score for a location |
| `GET /locations/{locationId}/device-health` | Device health score |
| `GET /locations/{locationId}/client-health` | Client health score |
| `GET /locations/{locationId}/services-health` | Services health score |
| `POST /analytics/client-health` | Client health analytics over time |
| `POST /analytics/device-health` | Device health analytics over time |
| `GET /copilot/anomalies` | AI-detected network anomalies |

---

## Direct Query Rule

**Scheduled jobs are automation tools, NOT data sources.** When a user asks a question
about network data, ALWAYS call the appropriate query tool directly.

| User asks | Correct approach | Wrong approach |
|---|---|---|
| "Any clients with bad radio?" | `p1_radio_quality_report()` | ~~Check if a monitoring job exists~~ |
| "What is the IP of my MacBook?" | `p1_client_snapshot(clientName="MacBook")` | ~~List scheduled jobs~~ |
| "Show all Apple clients" | `p1_clients_by_vendor(vendor="apple")` | ~~Trigger a monitoring job~~ |
| "How is the network doing?" | `p1_network_health_summary()` | ~~Enable a monitoring job~~ |
| "Who is connected to AP X?" | `p1_list_active_clients(connectedAp="AP X")` | ~~Check job status~~ |

**Never say "The data is still being queried."** You have direct synchronous access to
Platform One via tool calls. If a tool fails, say what failed and why. Never imply
there is a background process producing results later.

Only use `list_scheduled_jobs` / `enable_scheduled_job` / `trigger_scheduled_job` when
the user **explicitly** requests scheduled automation.

---

## Alarm Severity Actions

| Severity | Agent Action |
|---|---|
| CRITICAL | Immediate escalation |
| MAJOR | Auto-remediate if in scope, else escalate |
| MINOR | Log and include in next report |
| WARNING | Note in summary only |
| INFO | No action required |

---

## Device vs Client Terminology

In the Extreme / Platform One ecosystem these terms map to different endpoints:

**Device** — network infrastructure: AP, switch, router, SD-WAN appliance
- Listed at: `GET /xiq/v1/devices`
- Identified by numeric integer `id`
- Has: `id`, `mac_address`, `hostname`, `model`, `location_id`

**Client** — end-user device: phone, laptop, tablet, IoT sensor
- Listed at: `GET /xiq/v1/clients/active` (connected now) or `/client/v1/wireless-grid` (all)
- Primary lookup: MAC address; also has numeric `id`
- Has: `mac_address`, `hostname`, `ip_address`, `ssid`, `connected_ap`, `os_type`, `snr`, `rssi`

Rule of thumb:
- Has a user/owner (phone, laptop) → **client** → `/clients`
- Plugged into wall/ceiling (AP, switch) → **device** → `/devices`
- "Devices on AP X" in conversation usually means "clients connected to AP X"

---

## Legacy XIQ API (Backward Compatibility)

The legacy XIQ API remains operational for backward compatibility.

- Base URL: `https://api.extremecloudiq.com` (no `/xiq/v1/` prefix on legacy)
- Auth: `POST /login` with `{ userId, password }` → returns `{ access_token }`
- Token format: short-lived session token (~30 min), vault handles re-auth
- Credential type: username/password (not Bearer API token)

Legacy endpoints mirror the Platform One XIQ service but at the flat path:
- `GET /devices` — same schema as Platform One `/xiq/v1/devices`
- `GET /clients/active` — same schema
- `GET /locations` — location tree

**Prefer Platform One (`cloudapi.extremecloudiq.com`) for all new agents.**
Use legacy `api.extremecloudiq.com` only when connecting to older XIQ-only environments
that have not yet migrated to Platform One.

Legacy skill tools use `handlerType: 'http_call'` with Basic/session-token auth via vault,
whereas Platform One tools use `handlerType: 'p1_http_call'` with Bearer token auth.

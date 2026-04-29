# ExtremeCloud IQ (XIQ) — Operational Context

## Platform Overview

ExtremeCloud IQ (XIQ) is Extreme Networks' cloud-managed network management platform.
It manages Extreme Networks access points, switches, and SD-WAN devices.

---

## ⚠️ CRITICAL: Network Terminology — Device vs Client

In the Extreme Networks / XIQ ecosystem these terms have **precise meanings** and map to **different API endpoints**. Never confuse them.

### Device (a.k.a. "managed device")
- A **network infrastructure device** managed by XIQ: access point (AP), switch, router, SD-WAN device, server
- Listed at: `GET /devices`
- Identified by a **numeric integer `id`** (never a MAC address where ID is needed)
- Examples: "Beverly Home AP5010", "Core-Switch-2", "AP-Reception"
- Has: `id`, `mac_address`, `hostname`, `model`, `location_id`, `status`

### Client (a.k.a. "wireless client", "end-user device")
- An **end-user device connected to the wireless network**: phone, laptop, tablet, IoT device
- Listed at: `GET /clients/active` (currently connected) or `GET /clients` (all/historical)
- Identified by **MAC address** in the URL (e.g. `/clients/byMac/AA:BB:CC:DD:EE:FF`)
- Has a numeric `id` too (for detail endpoints), but primary key for lookup is MAC
- Examples: "Brendan's iPhone", "MacBook-Pro", any phone/laptop/tablet
- Has: `mac_address`, `hostname`, `ip_address`, `ssid`, `connected_ap`, `os_type`, `snr`, `rssi`

### How to answer common questions

| Question | Correct endpoint | Notes |
|---|---|---|
| "Show all clients on AP X" | `GET /clients/active` filter by `connected_ap` | Only clients connect to APs |
| "Show all devices on AP X" | `GET /clients/active` filter by `connected_ap` | **Same as above** — only clients connect to APs |
| "Show devices at location Y" | `GET /devices?locationId=Y` | Network infra at a location |
| "Who is connected to SSID X?" | `GET /clients/active` filter by `ssid` | |
| "What APs are in building Z?" | `GET /devices` filter by location | Devices = APs/switches |
| "Show me all devices" without context | Ask: device infra or client devices? | Ambiguous — clarify |
| "Is BonePhone online?" | `GET /clients/active?searchString=BonePhone` | Client/end-user device |
| "Check AP-5010 health" | `GET /monitor/devices/{id}` after listing devices | Infrastructure device |

**Rule of thumb:**
- If the thing has a user/owner (phone, laptop) → **client** → `/clients`
- If it's plugged into a wall/ceiling (AP, switch) → **device** → `/devices`
- "Devices on AP X" almost always means "clients connected to AP X" in conversation

---

## API Authentication

- XIQ uses Bearer token authentication.
- Login endpoint: `POST /login` with `{ userId, password }` — returns `{ access_token }`.
- Pass the token as `Authorization: Bearer <access_token>` on all subsequent calls.
- Credentials are stored in the Forge credential vault — never hardcode them.
- Tokens expire after ~30 minutes. The credential vault handles re-authentication automatically.

## API Base URL

All paths below are relative to `https://api.extremecloudiq.com`. There is **no** `/xapi/v1/` prefix.

## Key Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /devices` | List all managed devices. Returns numeric `id`, `mac_address`, `hostname`, `location_id` |
| `GET /devices/{id}` | Get details for one device by numeric ID |
| `GET /devices/radio-information` | Radio stats (channel, power, noise) — requires `deviceIds[]` of integers |
| `GET /clients/active` | Active wireless clients. Returns `ssid`, `ip_address`, `mac_address`, `os_type` |
| `GET /network-policies` | List network policies |
| `GET /network-policies/{id}/ssids` | SSIDs under a policy — returns `name`, `default_user_profile` |
| `GET /user-profiles/{id}` | User profile including VLAN assignment |
| `GET /network/vlan-profiles` | VLAN profiles with `id`, `name`, `default_vlan_id` |
| `GET /locations` | Location tree (sites, buildings, floors) — returns numeric `id` |
| `GET /monitor/devices/{id}` | Live device health stats |

## CRITICAL: Parameter Types and ID Chaining

XIQ uses **numeric integer IDs** throughout — never pass MAC addresses where an ID is needed.

### Pattern: Get device IDs before using device-specific tools

```
Step 1: list_devices → returns [{id: 12345678, mac_address: "AA:BB:CC:...", hostname: "AP-Office"}]
Step 2: Use id (integer) in subsequent calls
  - list_devices_radio_information(deviceIds=[12345678, 87654321])
  - GET /monitor/devices/12345678
  - GET /devices/12345678
```

**Common mistake**: passing `mac_address` values to tools that require `id`. The error "NOT_FOUND" almost always means an integer ID was expected but a string was passed.

### Pattern: Radio quality by location

```
Step 1: list_devices(locationId=<loc_id>)  → get numeric IDs for APs at the location
Step 2: list_devices_radio_information(deviceIds=[...numeric ids...])
Step 3: Group results by location/floor
```

### Pattern: SSID → VLAN → Client correlation

```
Step 1: GET /network-policies           → policy list with IDs
Step 2: GET /network-policies/{id}/ssids → SSID names + user_profile IDs
Step 3: GET /user-profiles/{up_id}      → vlan_profile.id, default_vlan_id
Step 4: GET /network/vlan-profiles      → vlan name + default_vlan_id
Step 5: GET /clients/active             → clients with ssid + ip_address
Step 6: Correlate SSID → VLAN → clients
```

## Pagination

All list endpoints use page/limit parameters:
- `page` (integer, min 1) — page number
- `limit` (integer, min 1, max 100) — items per page
- Always check if more pages are needed for complete data.

## Common Response Shapes

```json
// GET /devices response
{
  "data": [
    { "id": 12345678, "mac_address": "...", "hostname": "AP-Office-1", "location_id": 99 }
  ],
  "hasMore": false
}

// GET /devices/radio-information response
{
  "data": [
    {
      "device_id": 12345678,
      "radio_list": [
        { "radio_type": "WIFI5", "channel": 36, "tx_power": 17, "noise_floor": -95 }
      ]
    }
  ]
}

// GET /clients/active response
{
  "data": [
    { "ssid": "Corp-WiFi", "ip_address": "10.0.1.5", "mac_address": "AA:BB:CC:DD:EE:FF", "os_type": "Mac OS X" }
  ]
}
```

## Alarm Severity Mapping

| XIQ Severity | Forge Action |
|---|---|
| CRITICAL | Immediate escalation |
| MAJOR | Auto-remediate if in scope, else escalate |
| MINOR | Log and include in next report |
| WARNING | Note in summary only |

## SSH Access

Advanced operations can use direct SSH:
- Tool: `ssh_exec` with the device's management IP
- Credentials resolved from vault by target name
- Common: `show version`, `show interface`, `show alarm`, `show config`

## Client Operations

### ⚠️ Finding Apple/iOS/Android Clients by Vendor — NEVER use searchString="Apple"

`searchString` searches display names and aliases — it does NOT search `os_type`. Searching `searchString=Apple` returns zero results because device names are like "BonePhone", "Brendan's MacBook", not "Apple".

**Always use `xiq_clients_by_vendor` tool for vendor/OS queries:**
```
xiq_clients_by_vendor(vendor="apple")       → all Apple clients (iPhone/iPad/Mac/Watch)
xiq_clients_by_vendor(vendor="android")     → all Android clients
xiq_clients_by_vendor(vendor="apple", apName="Beverly")  → Apple clients on APs with "Beverly" in name
```

**Apple client detection uses 3 signals (multi-strategy):**
1. `os_type` contains: 'Apple iOS', 'macOS', 'Mac OS X', 'iPadOS', 'watchOS'
2. Hostname contains: 'iPhone', 'iPad', 'MacBook', 'iMac', 'AirPods', 'Apple Watch'
3. MAC OUI (first 3 octets) matches known Apple IEEE-registered OUIs

**Why os_type alone fails:** iOS devices with MAC randomisation have unknown OUIs so XIQ fingerprints them as 'Undetermined'. A device named "BonePhone" is an iPhone but its `os_type` may be blank.
**Why searchString fails:** It only matches display name/alias, never `os_type` or vendor info.

### Finding a Client by Name or Alias

Use `xiq_client_snapshot` (composite handler — preferred) or `list_active_clients` with `searchString`:

```
xiq_client_snapshot(clientName="BonePhone")
  → is_currently_connected, current_connection {ap, ssid, ip, snr, rssi, health_score}, last_seen_at
```

The `searchString` matches against: hostname, alias, username, MAC address prefix.
**Important**: `searchString` may NOT match the iOS `hostname` field in all XIQ versions.
**Do NOT use `views` parameter** — `list_active_clients` with `views` causes a 400 error. SNR/RSSI come from the `/client-details/overview/info/{id}` endpoint, not the client list.

### Fallback Search Strategy (when searchString returns 0 results)

If `searchString` returns no results but you believe the device might be connected, use the composite `xiq_client_snapshot` tool — it automatically tries all strategies:
1. `searchString` against active clients
2. Fetch all active clients (up to 500) and filter client-side where `hostname` contains the search term
3. Search historical `/clients` by `searchString`  
4. Historical clients filtered by `hostname`

**This handles iOS devices** where the hostname (e.g. "BonePhone") is set by the device but may differ from the XIQ display name/alias.

### Getting Full Client Details

Once you have the numeric client ID (from `xiq_client_snapshot` or `list_active_clients`):

```
/client-details/overview/info/{clientId}?startTime={ms}&endTime={ms}
  → snr, rssi, tx_rate, rx_rate, channel, band, connected_ap, ssid, ip_address, os_type, health_score
  NOTE: Do NOT use get_client with views parameter — views causes 400 errors

get_client_stats(clientId=11223344, startTime=<now-3600000>, endTime=<now>)
  → current connection metrics: SNR, RSSI, data rate, retry rate

get_client_events(clientId=11223344, startTime=<now-86400000>, endTime=<now>)
  → timeline of connect/disconnect/roam/auth-fail events
```

### Checking When a Device Connected or Left

```
Step 1: list_active_clients(searchString="BonePhone") — if empty, device is NOT currently connected
Step 2: get_client_by_mac(clientMac="AA:BB:CC:DD:EE:FF") — get numeric ID even if not active
Step 3: get_client_events(clientId=<id>, startTime=<24h_ago_ms>, endTime=<now_ms>)
  → look for event_type = "DISCONNECTED" / "CONNECTED" with timestamp
Step 4: get_connection_trail(macAddress="AA:BB:CC:DD:EE:FF")
  → full chronological roaming map across all APs
```

### Device Presence Detection (for scheduled monitoring)

Pattern for tracking whether a named device is on the network:
```
1. list_active_clients(searchString="BonePhone")
2. If results.length > 0 → PRESENT at results[0].connected_ap on results[0].ssid
3. If results.length = 0 → ABSENT (last seen via get_client_events)
4. Compare to previous state to detect ARRIVAL or DEPARTURE events
```

### Client `views` Parameter Reference

Pass `views` as an array to `list_active_clients` and `get_client` to get richer fields:

| View | Fields returned |
|---|---|
| `CLIENT_DETAILS` | snr, rssi, tx_rate, rx_rate, channel, band, connected_ap_id |
| `HEALTH_STATUS` | health_score, health_category |
| `DEVICE_INFO` | os_type, manufacturer, model |
| `BASIC` | id, hostname, mac_address, ip_address, ssid, user_profile |

### Time Parameters

All client detail endpoints use epoch milliseconds:
```js
const now = Date.now();
const last24h = now - 86_400_000;
const lastHour = now - 3_600_000;
```


### Offline Client Lookups — MAC Address is Key

When a client is not currently connected, XIQ can only look up history via MAC address (not by name).
The `xiq_client_snapshot` handler handles this automatically, but needs the MAC:

```
Pattern: check memory first
1. Check agent memory for "<DeviceName>_mac" key (e.g. "BonePhone_mac")
2. If found: pass it as macAddress parameter to xiq_client_snapshot
3. xiq_client_snapshot will then query connection trail and return last_seen_at

Pattern: when device IS found connected
1. Save mac_address to memory as "<DeviceName>_mac" for future offline lookups
2. Save connection state for change detection
```

### Reading the xiq_client_snapshot response

The response always includes `status_message` — a ready-to-report plain-English summary:
- Connected: "BonePhone is CONNECTED on AP-Office-1 (Corp-WiFi)"
- Offline with history: "BonePhone is NOT currently connected. Last seen: 2026-04-22T09:10:00Z on AP-Reception (Corp-WiFi)"
- Offline no history: "BonePhone not found in active clients. Provide macAddress to retrieve connection history."

Always report the `status_message` to the user. Also include `last_seen_at` when relevant.

---

## ⚠️ CRITICAL: Query Strategy — NEVER Use Scheduled Jobs as Data Source

**Scheduled jobs are automation tools, NOT data sources.** When a user asks a question about network data, ALWAYS call the appropriate XIQ query tool directly. Never use `list_scheduled_jobs`, `enable_scheduled_job`, `trigger_scheduled_job`, or any job management tool to answer a data question.

### Rule: Direct Query First

| User asks | CORRECT approach | WRONG approach |
|---|---|---|
| "Are there clients with bad radio?" | `xiq_radio_quality_report()` or `xiq_client_health_report()` | ~~Check if a monitoring job exists~~ |
| "What is the IP of my MacBook?" | `xiq_client_snapshot(clientName="MacBookPro")` | ~~List scheduled jobs~~ |
| "Show me all Apple clients" | `xiq_clients_by_vendor(vendor="apple")` | ~~Trigger a monitoring job~~ |
| "How is the network doing?" | `xiq_network_overview()` | ~~Enable a monitoring job~~ |
| "Who is connected to AP X?" | `list_active_clients(connectedAp="AP X")` | ~~Check job status~~ |

### When TO Use Scheduled Jobs

Only call `list_scheduled_jobs` / `enable_scheduled_job` / `trigger_scheduled_job` when the user **explicitly** says one of:
- "set up a scheduled job"
- "automate this check"
- "run this on a schedule"
- "enable the monitoring job"
- "what scheduled jobs are there?"

If the user says "don't enable a job, just show the data" — stop any job-related actions immediately and call the direct XIQ data tool.

### Handling "Bad Radio Quality" Queries

For any question about poor signal, bad RSSI/SNR, weak connection:
1. Call `xiq_radio_quality_report()` → returns clients grouped by health (poor/fair/good)
2. OR call `xiq_client_health_report()` → returns health breakdown with signal stats
3. Filter for clients where `snr < 20` (bad) or `rssi < -72` (bad)
4. Report the count and list the worst offenders

Do NOT look for a job to run. Do NOT wait for scheduled data. Query directly.

### Response Completion Rule

**Never say "The data is still being queried" or "I will update you when I have the data."**
You have direct access to XIQ via tool calls. If a tool call fails, say what failed and why.
If the tool returns data, report it immediately. You are synchronous — there is no background process.

---

## Radio Quality Thresholds (for bad radio classification)

| Metric | Good | Fair | Poor (Bad) |
|---|---|---|---|
| SNR | ≥ 25 dB | 15–24 dB | < 15 dB |
| RSSI | ≥ -67 dBm | -68 to -80 dBm | < -80 dBm |
| Health Score | ≥ 70 | 40–69 | < 40 |

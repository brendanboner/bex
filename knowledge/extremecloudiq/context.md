# ExtremeCloud IQ (XIQ) — Operational Context

## Platform Overview

ExtremeCloud IQ (XIQ) is Extreme Networks' cloud-managed network management platform.
It manages Extreme Networks access points, switches, and SD-WAN devices.

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

### Finding a Client by Name or Alias

The most important pattern for client queries. Use `searchString` in `list_active_clients`:

```
Step 1: list_active_clients(searchString="BonePhone", views=["CLIENT_DETAILS","HEALTH_STATUS"])
  → Returns: [{ id: 11223344, hostname: "BonePhone", mac_address: "AA:BB:...", ssid: "Corp-WiFi",
                connected_ap: "AP-Office-1", snr: 35, rssi: -60, ip_address: "10.0.1.42", health_score: 85 }]
Step 2: Use id (integer 11223344) for all further queries
```

The `searchString` matches against: hostname, alias, username, MAC address prefix.
If the client is not in active clients → device is currently **not connected**.

### Getting Full Client Details

Once you have the numeric client ID:

```
get_client(id=11223344, views=["CLIENT_DETAILS","HEALTH_STATUS","DEVICE_INFO"])
  → snr, rssi, tx_rate, rx_rate, channel, band, connected_ap, ssid, ip_address, os_type, health_score

get_client_stats(clientId=11223344, startTime=<now-3600000>, endTime=<now>)
  → current connection metrics: SNR, RSSI, data rate, retry rate

get_client_health(clientId=11223344, startTime=<now-86400000>, endTime=<now>)
  → health trend chart data for the last 24 hours

get_client_events(clientId=11223344, startTime=<now-86400000>, endTime=<now>)
  → timeline of connect/disconnect/roam/auth-fail events (equivalent to /clients/{id}/events)
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


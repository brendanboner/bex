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

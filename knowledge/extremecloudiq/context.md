# ExtremeCloud IQ (XIQ) — Operational Context

## Platform Overview

ExtremeCloud IQ (XIQ) is Extreme Networks' cloud-managed network management platform.
It manages Extreme Networks access points, switches, and SD-WAN devices.

## API Authentication

- XIQ uses Bearer token authentication
- Token endpoint: `POST /auth/credentials/ad/users/login`
- Tokens expire — refresh before making API calls if the session is > 30 minutes old
- Credentials are stored in the Forge credential vault — never hardcode

## Key API Domains

| Domain | Purpose |
|---|---|
| `/xapi/v1/devices` | List, query, and manage network devices |
| `/xapi/v1/clients` | Query connected wireless and wired clients |
| `/xapi/v1/alarms` | Query active alarms and events |
| `/xapi/v1/locations` | Physical location hierarchy (sites, buildings, floors) |
| `/xapi/v1/network-policies` | Network policies applied to devices |

## Common Queries

```
# List all devices
GET /xapi/v1/devices?views=full&page=1&limit=100

# Get active alarms
GET /xapi/v1/alarms?acknowledged=false&severity=critical,major

# Find a client by MAC
GET /xapi/v1/clients?macAddress=AA:BB:CC:DD:EE:FF

# Device details
GET /xapi/v1/devices/{id}?views=full
```

## Pagination

XIQ uses cursor-based pagination. Always check `hasMore` in the response and follow
`nextPage` links to retrieve complete results for large datasets.

## SSH Access

Some advanced operations require direct SSH to the device:
- Use the `ssh_exec` tool with the device's management IP
- Credentials are resolved from the vault by target name
- Common commands: `show version`, `show interface`, `show alarm`, `show config`

## Alarm Severity Mapping

| XIQ Severity | Forge Action |
|---|---|
| CRITICAL | Immediate escalation |
| MAJOR | Auto-remediate if in scope, else escalate |
| MINOR | Log and include in next report |
| WARNING | Note in summary only |
| INFO | Ignore unless specifically requested |

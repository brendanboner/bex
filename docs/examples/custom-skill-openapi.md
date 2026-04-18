# Example: Build a Skill from Any OpenAPI Spec

This guide shows how to build a complete, production-ready skill set from any OpenAPI 3.x specification — in a single command.

---

## What You Get

For each tag in the OpenAPI spec, the skill engine generates:

- A **skill domain** (`myplatform.users`, `myplatform.devices`, etc.)
- **Tool definitions** for every operation (GET, POST, PUT, PATCH, DELETE)
- A **system prompt** with:
  - Pagination guidance (detected from `page`/`limit` params)
  - Search pattern guidance (detected from `searchString`/`search` params)
  - ID-chaining guidance (when list ops have IDs used by get ops)
  - Write safety instructions
- Automated **tests** before publishing

---

## Step 1 — Identify Your OpenAPI Spec

Most modern APIs publish their spec at one of:

```
https://api.example.com/openapi.json
https://api.example.com/swagger.json
https://api.example.com/v1/openapi
https://developer.example.com/api-reference
```

You can also provide a local file path or paste the spec JSON directly.

---

## Step 2 — Tell Forge to Build the Skills

In Telegram or the dashboard chat:

```
Build a skill for the Meraki networking platform using:
- OpenAPI spec: https://api.meraki.com/api/v1/openapiSpec
- Base URL: https://api.meraki.com/api/v1
- Domain prefix: meraki
- Authentication: Bearer token (API key in Authorization header)
```

The agent will:
1. Fetch and validate the spec
2. Preview the skill structure:

```
Preview — 8 skill domains from Meraki API:

  meraki.networks      42 ops (38 read, 4 write)
  meraki.devices       28 ops (24 read, 4 write)
  meraki.clients       16 ops (14 read, 2 write)
  meraki.ssids         22 ops (12 read, 10 write)
  meraki.vlans         18 ops (10 read, 8 write)
  meraki.alerts        8 ops  (8 read, 0 write)
  meraki.firmware      6 ops  (5 read, 1 write)
  meraki.traffic       11 ops (11 read, 0 write)

Build all 8 skills? [Yes / No / Customise]
```

---

## Step 3 — Customise (Optional)

You can control what gets built:

```
Build only the read-only skills (networks, devices, clients)
Skip the firmware and traffic domains
```

Or specify maximum tools per skill (default: 40):
```
Build all skills but limit to 30 tools per skill
```

---

## Step 4 — Review and Approve

After building, the engine runs tests. Review the results:

```
✅ Build complete — 8 skills built, all tests passed:

  meraki.networks      ✅ 3/3 tests passed
  meraki.devices       ✅ 3/3 tests passed
  meraki.clients       ✅ 3/3 tests passed
  meraki.ssids         ⚠️ 2/3 tests passed (1 write test failed — 403 Forbidden)
  meraki.vlans         ✅ 3/3 tests passed
  meraki.alerts        ✅ 2/2 tests passed
  meraki.firmware      ✅ 2/2 tests passed
  meraki.traffic       ✅ 2/2 tests passed

Note: meraki.ssids write test failed — likely requires elevated permissions.
The read tools are fully functional.

Publish all 8 skills to the registry? [Approve / Deny]
```

---

## Step 5 — Store Credentials

Before your agent can call the API, store the credentials:

```
Create a credential named "Meraki Production" with API key <your-key>
```

Or in the dashboard: **Credentials → New Credential → API Token**

---

## Step 6 — Create an Agent

```
Create an agent called "Meraki Manager" using:
- All meraki.* skills
- Credential: Meraki Production  
- Permissions: read:network, write:network
- Requires approval for all write operations
```

---

## Step 7 — Test It

```
List all Meraki networks in my organisation
```

```
Show devices in the "Branch Office" network
```

```
What clients are connected to the "HQ-WiFi" SSID right now?
```

---

## Programmatic API

You can also build skills via the REST API — useful for CI/CD pipelines:

```bash
curl -X POST http://localhost:4000/skills/build \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "specUrl": "https://api.meraki.com/api/v1/openapiSpec",
    "baseUrl": "https://api.meraki.com/api/v1",
    "domainPrefix": "meraki",
    "handlerType": "public_http_call",
    "maxToolsPerSkill": 40,
    "excludeTags": ["Firmware Updates"],
    "autoPublish": false
  }'
```

Response:
```json
{
  "ok": true,
  "data": {
    "jobId": "skill-build-abc123",
    "estimatedSkills": 8,
    "status": "BUILDING"
  }
}
```

Poll for completion:
```bash
curl http://localhost:4000/skills/build/skill-build-abc123 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Supported OpenAPI Features

| Feature | Supported |
|---|---|
| OpenAPI 3.x (JSON or YAML) | ✅ |
| Path parameters (`{id}`) | ✅ |
| Query parameters | ✅ |
| Request body (JSON) | ✅ |
| Nested body properties | ✅ (first level) |
| `$ref` schemas | ✅ (simple refs) |
| Multiple servers | ✅ (uses first) |
| Tags for grouping | ✅ |
| Operation IDs | ✅ (used as tool name) |
| Summary/description | ✅ (used in tool description) |
| OAuth2 / Bearer auth | ✅ (via credential vault) |
| Basic Auth | ✅ (via credential vault) |
| API Key header | ✅ (via credential vault) |
| File uploads | ❌ (not supported) |
| Streaming responses | ❌ (not supported) |

---

## Tips for Better Skills

**Provide additional context** when building:

```
Build a skill for Cisco Catalyst Center using
https://developer.cisco.com/docs/catalyst-center/api/2.3.7/

Additional context:
- Authentication is two-step: POST /dna/system/api/v1/auth/token with Basic Auth,
  then use the returned Token in X-Auth-Token header
- Rate limit: 15 requests per second
- Use https://sandboxdnac.cisco.com as the test base URL
```

The agent will incorporate this into the system prompt and configure the handler correctly.

**Review the generated system prompt** in the dashboard (Skills → [Skill] → System Prompt) and edit if needed. Common additions:
- Domain-specific ID formats
- Special header requirements
- Known API bugs or workarounds

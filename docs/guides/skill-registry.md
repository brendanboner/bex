# Skill Registry

Skills are versioned, testable capability packages. The skill registry is a shared hub where skills are published, discovered, and distributed across Forge instances.

---

## Concepts

| Term | Meaning |
|---|---|
| **Skill** | A set of tools + system prompt for a specific domain (e.g. "ExtremeCloud IQ — Clients") |
| **Domain** | A namespaced identifier: `extremecloudiq.clients`, `xco.fabric`, `weather.forecast` |
| **Registry** | The central server (port 5050) where skills are published and pulled from |
| **Learned notes** | Runtime-discovered API quirks, accumulated per-skill over real interactions |

---

## Registry Architecture

```
Forge Instance A             Forge Instance B
┌──────────────────┐         ┌──────────────────┐
│  Skill Engine    │ push →  │                  │
│  (builds skills) │         │   Skill Registry │ ← pull
│                  │         │   :5050          │
│  Skill Registry  │ ← pull  │                  │
│  Client          │         │  (SQLite)        │
└──────────────────┘         └──────────────────┘
```

Any Forge instance can act as a registry. Set `SKILL_REGISTRY_URL` in `.env` to point at a shared registry.

---

## Publishing a Skill

Skills are published automatically after the skill engine builds and tests them. You can also publish manually:

### Via the Dashboard

1. Go to **Skills → [Skill Name]**
2. Click **Publish to Registry**
3. Confirm the version and changelog

### Via the API

```bash
curl -X POST http://localhost:4000/skills/:id/publish \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Via the Chat Interface

```
Publish the extremecloudiq.clients skill to the registry
```

---

## Pulling Skills from a Registry

### Configure the Registry URL

In `.env`:
```bash
SKILL_REGISTRY_URL=https://skills.yourorg.com
```

### Pull All Available Skills

```bash
# Via dashboard
Settings → Skill Registry → Sync Now

# Via chat
Pull all available skills from the registry
```

### Pull a Specific Skill

```
Pull the extremecloudiq.clients skill from the registry
```

---

## Admin Operations

Publishing and deletion require the registry admin token.

In `.env`:
```bash
REGISTRY_ADMIN_TOKEN=your-strong-random-token
```

### Delete a Skill from the Registry

```bash
curl -X DELETE http://localhost:5050/skills/extremecloudiq.clients \
  -H "Authorization: Bearer $REGISTRY_ADMIN_TOKEN"
```

Or via the dashboard: **Settings → Skill Registry → [Skill] → Delete**.

---

## Versioning

Skills use semantic versioning (`MAJOR.MINOR.PATCH`). When a skill is rebuilt from an updated OpenAPI spec:

- `PATCH` bump — no new tools, only prompt improvements or bug fixes
- `MINOR` bump — new tools added, backwards compatible
- `MAJOR` bump — breaking changes (tool renames, parameter changes)

The registry preserves all versions. Agents pin to a specific version at assignment time.

---

## Registry API

The skill registry exposes a simple REST API:

```bash
# List all skills
GET  http://localhost:5050/skills

# Get a specific skill
GET  http://localhost:5050/skills/:domain

# Publish (requires admin token)
POST http://localhost:5050/skills
  Authorization: Bearer $REGISTRY_ADMIN_TOKEN
  Body: { name, domain, version, systemPrompt, tools[], ... }

# Delete (requires admin token)
DELETE http://localhost:5050/skills/:domain
  Authorization: Bearer $REGISTRY_ADMIN_TOKEN

# Health check
GET  http://localhost:5050/health
```

---

## Building a New Skill

### From an OpenAPI Spec

```
Build a skill from https://api.myplatform.com/openapi.json
```

The skill engine will:
1. Fetch the OpenAPI spec
2. Group operations by tag (each tag becomes a skill domain)
3. Generate tool definitions with proper parameter schemas
4. Write system prompts with pagination/search/safety guidance
5. Run automated tests
6. Publish to the registry (after your approval)

### From a URL + Documentation

```
Build a skill for Meraki networking using:
- API docs: https://developer.cisco.com/meraki/api-v1/
- Base URL: https://api.meraki.com/api/v1
```

### Manually

Create a skill directly in the dashboard:
1. **Skills → New Skill**
2. Enter name, domain, system prompt
3. Add tools individually (name, description, handler type, URL template, parameters)
4. Test and publish

---

## Skill Domains: Naming Convention

Use reverse-DNS style namespacing:

```
extremecloudiq.devices      # XIQ device management
extremecloudiq.clients      # XIQ client/station management
extremecloudiq.vlans        # XIQ VLAN configuration
xco.fabric                  # XCO fabric topology
xco.alarms                  # XCO alarm management
weather.forecast            # Weather data
github.repositories         # GitHub repo management
```

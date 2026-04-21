# Skill Learning

Forge agents get smarter over time. When an agent discovers that an API behaves differently from its documentation — a filter that only accepts exact matches, a field that uses an unexpected value, a rate limit not mentioned in the spec — it can permanently record this knowledge.

---

## How It Works

Every agent run includes a `skill_add_note` tool alongside the domain-specific tools. The LLM calls this tool when it discovers something worth remembering:

```
Agent calls list_active_clients(clientOsNames=iOS)
→ Returns 0 results
→ Agent tries list_active_clients(searchString=iPhone)
→ Returns 2 results
→ Agent calls skill_add_note:
    domain: "extremecloudiq.clients"
    note: "iPhones show os_type='unknown', not 'iOS'. Use searchString=iPhone to find them."
```

The note is persisted to `Skill.learnedNotes` in the database. On every future request that uses the `extremecloudiq.clients` skill, this note is injected into the system prompt — so the agent never makes the same mistake again.

---

## Architecture

```
Agent execution
      │
      ├── skill_add_note tool (always available)
      │         │
      │         ▼
      │   appendSkillNote(prisma, domain, note)
      │         │
      │         ▼
      │   Skill.learnedNotes (Postgres)
      │         │
      └─────────┘
                │ (next request)
                ▼
      buildEnrichedSystemPrompt(base, skills)
                │
                ▼
      ┌─────────────────────────────────┐
      │  Base system prompt             │
      │  ---                            │
      │  ## Learned Notes               │
      │  extremecloudiq.clients:        │
      │  • [2026-04-18] iPhones show    │
      │    os_type='unknown'...         │
      │  • [2026-04-15] hostnames       │
      │    filter is exact-match only   │
      └─────────────────────────────────┘
```

---

## Note Storage Format

Notes are stored as a single timestamped string in `Skill.learnedNotes`, with a 8000-char rolling window (oldest notes trimmed automatically):

```
[2026-04-18] iPhones show os_type='unknown', not 'iOS'. Use searchString=iPhone to find them.
[2026-04-18] list_devices hostnames filter is exact-match only — list all then filter client-side.
[2026-04-15] Pagination: always use limit=100. Default is 10. total_count (snake_case) not totalCount.
```

---

## Enriched System Prompt

The `buildEnrichedSystemPrompt` function merges the base skill prompt with accumulated notes:

```
You manage ExtremeCloud IQ — Client operations.

READ ops (12): Execute freely.
WRITE ops (3): Always confirm before POST/PUT/PATCH/DELETE.

PAGINATION:
- Always pass limit=100 for comprehensive results.
...

---

## Learned Notes (extremecloudiq.clients)

The following notes were recorded by agents during real interactions.
They take precedence over API documentation where they conflict:

• [2026-04-18] iPhones show os_type='unknown', not 'iOS'...
• [2026-04-18] list_devices hostnames filter is exact-match only...
```

---

## Updating Notes Manually

Notes can be updated directly via the dashboard (**Skills → [skill] → Learned Notes**) or via the REST API:

```bash
# View notes for a skill
curl http://localhost:4001/skills/extremecloudiq.clients \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Append a note
curl -X PATCH http://localhost:4001/skills/extremecloudiq.clients/notes \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"note": "Rate limit is 60 req/min for /clients endpoints"}'
```

---

## Viewing Notes in Logs

Each request logs the tool router's reasoning. When learned notes are active, you'll see:

```
[orchestrator] Domain: ExtremeCloud IQ (XIQ) (score=6) | Tier: 1 | 588→25 selected
[orchestrator] Skill extremecloudiq.clients: 2 learned notes injected
```

---

## Best Practices for Agents

The agent system prompt for every skill includes this instruction:

> Use `skill_add_note` to save any API behaviour you discover that differs from documentation.

Agents are encouraged to call it proactively when they:
- Discover a filter that doesn't work as documented
- Find an unexpected field name or value format
- Determine a workaround for a known API limitation
- Notice rate limits or pagination quirks not in the spec

---

## Domain Intelligence Layer

Skill learning operates at the **skill level** (per-domain API quirks). The Domain Intelligence Layer operates at the **domain level** (entity relationships and complex workflows). They are complementary.

### How Domain Intelligence is Populated

When a skill is built from a URL (`POST /skills/build`), the skill engine runs three LLM passes:

1. **Tool generation** — parses the OpenAPI spec and creates `SkillTool` records.
2. **Doc discovery** (`discoverLinkedDocs()`) — scrapes the source URL for all same-host links, visits each page, and categorises them:
   - `api_guide` — API reference pages
   - `cli` — CLI/command reference
   - `troubleshooting` — known issues and FAQs
   - `release_notes` — changelog pages
   - `user_guide` — conceptual guides
   - `other` — everything else

   Results are stored as `DocRef[]` in `DomainKnowledge.docIndex`.

3. **Playbook generation** (`generatePlaybooks()`) — a third LLM pass analyses the discovered documentation and generates 1–3 analysis playbooks: step-by-step workflows for complex multi-step queries (e.g. "radio quality by location", "VLAN-to-IP mapping"). Results are stored in `DomainKnowledge.playbooks`.

### Runtime Injection

At every agent execution, the orchestrator reads `DomainKnowledge` for the agent's domain(s) and:

- **Always** injects the entity graph into the system prompt as a compact relationship map (e.g. `Client(mac_address) → AP(ap_id) → Location(location_id)`).
- **Conditionally** injects matching playbooks: if ≥2 trigger words from the user's query appear in a playbook's `triggerPatterns` list, the full playbook (steps) is injected.

This means complex queries like "Show me radio quality broken down by location" automatically receive a playbook with the exact API call sequence — without RAG, vector search, or manual curation.

### Managing Domain Intelligence

```bash
# View domain knowledge
GET /domains
GET /domains/extremecloudiq/knowledge

# Replace entity graph or playbooks
PUT /domains/extremecloudiq/knowledge

# Add or update playbooks only
PATCH /domains/extremecloudiq/knowledge/playbooks

# Retroactively generate playbooks for an existing skill
POST /skills/:id/generate-playbooks
```

The dashboard **Domain Intel** page (`/domains`) provides a visual editor for entity graphs and playbooks.

See [Domain Intelligence](domain-intelligence.md) for the full reference.

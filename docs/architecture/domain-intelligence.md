# Domain Intelligence Layer

The Domain Intelligence Layer gives every Forge agent deep structural knowledge of their domain — entity relationships, documentation references, and step-by-step playbooks for complex queries — without RAG pipelines, vector databases, or manual curation.

---

## Why It Exists

When agents receive complex queries like "Show me radio quality broken down by location" or "Map all VLAN IDs to their IP ranges", they need to:

1. Know which API calls to chain (locations → APs per location → radio stats per AP)
2. Know the correct field names and entity relationships
3. Know how to aggregate and format the results

Without explicit guidance, LLMs either hallucinate API paths, make redundant calls, or give up. The Domain Intelligence Layer solves this by injecting pre-computed, domain-specific knowledge into every system prompt — automatically, at runtime.

---

## Components

### 1. Doc Index (`docIndex`)

A typed list of documentation pages for the domain, scraped and categorised at skill-build time.

**Structure:**
```ts
type DocRef = {
  url:      string;
  title:    string;
  category: "api_guide" | "cli" | "troubleshooting" | "release_notes" | "user_guide" | "other";
};
```

**How it's built:** When a skill is built from a URL, `discoverLinkedDocs()` in `@bex/skill-engine`:
1. Fetches the source URL
2. Extracts all same-host links from the page
3. Visits each link and reads the title
4. Classifies each page by category using LLM analysis of the URL path and page content
5. Stores the result as `DocRef[]` in `DomainKnowledge.docIndex`

**Use:** The doc index is displayed on the **Domain Intel** dashboard page (`/domains`) and is available to agents that need to find reference documentation. It is not injected into every prompt (it can be large), but individual docs can be fetched and injected on demand.

---

### 2. Entity Graph (`entityGraph`)

A compact JSON representation of the domain's entity relationships. Always injected into every agent system prompt.

**XIQ example:**
```json
{
  "entities": {
    "Client": {
      "key": "mac_address",
      "relations": { "connected_to": "AP" }
    },
    "AP": {
      "key": "ap_id",
      "relations": { "belongs_to": "Location", "has_radios": "Radio" }
    },
    "Location": {
      "key": "location_id",
      "relations": { "contains": ["AP"] }
    },
    "VLAN": {
      "key": "vlan_id",
      "relations": { "uses_policy": "Policy" }
    }
  },
  "recipes": {
    "subnet_inference": "Use ip_address + prefix_length from network_policy to compute CIDR range",
    "telemetry_extraction": "Fetch /monitor/radios for real-time signal, interference, and channel data"
  }
}
```

**How it's used:** The orchestrator serialises this to a compact string and injects it into the system prompt as:

```
## Domain Entity Graph
Client(mac_address) → AP(ap_id) → Location(location_id)
VLAN(vlan_id) → Policy
Recipe: subnet_inference — Use ip_address + prefix_length from network_policy to compute CIDR range
```

This prevents the LLM from hallucinating field names and guides it to chain API calls in the correct order.

---

### 3. Playbooks (`playbooks`)

Step-by-step workflow guides for complex, multi-API queries. Injected into the prompt only when ≥2 trigger words from the user's query match the playbook's `triggerPatterns`.

**Structure:**
```ts
type Playbook = {
  name:            string;   // kebab-case identifier
  description:     string;   // human-readable summary
  triggerPatterns: string[]; // words that activate this playbook
  steps:           string[]; // ordered instructions for the LLM
};
```

**XIQ example — radio quality by location:**
```json
{
  "name": "radio-quality-by-location",
  "description": "Analyse radio signal quality and interference grouped by physical location",
  "triggerPatterns": ["radio", "quality", "location", "signal", "interference", "rssi"],
  "steps": [
    "1. Fetch all locations: GET /locations",
    "2. For each location_id, fetch APs: GET /aps?location_id={id}",
    "3. For each ap_id, fetch radio stats: GET /monitor/radios?ap_ids={id}",
    "4. Extract: signal_db, noise_db, interference_db, channel, connected_client_count",
    "5. Aggregate by location: average signal and interference, sum client count",
    "6. Sort locations by average interference descending (worst first)",
    "7. Present as table: Location | APs | Avg Signal | Interference | Clients"
  ]
}
```

**XIQ example — VLAN to IP range mapping:**
```json
{
  "name": "vlan-ip-range-mapping",
  "description": "Map VLAN IDs to their IP subnets and gateway addresses",
  "triggerPatterns": ["vlan", "ip", "range", "subnet", "gateway", "network", "mapping"],
  "steps": [
    "1. Fetch all VLANs: GET /vlans",
    "2. For each vlan_id, fetch associated network policy: GET /network-policies?vlan_id={id}",
    "3. Extract ip_address and prefix_length from each policy",
    "4. Compute CIDR: ip_address/prefix_length (recipe: subnet_inference)",
    "5. Extract gateway from ip_address (typically .1 of the subnet)",
    "6. Present as table: VLAN ID | Name | IP Range | Gateway"
  ]
}
```

---

## Trigger Word Matching

The orchestrator scans the user's input for words that appear in each playbook's `triggerPatterns`. If **2 or more** trigger words match, the playbook is injected into the system prompt.

**Example:**
- Query: `"Show me radio signal quality broken down by location"`
- Words: radio, signal, quality, broken, down, by, location
- Matches `radio-quality-by-location` (radio ✓, signal ✓, quality ✓, location ✓) → **injected**
- Does not match `vlan-ip-range-mapping` (0 trigger words) → **skipped**

Multiple playbooks can be injected simultaneously if the query touches multiple domains.

---

## Auto-Population

Domain intelligence is populated automatically when skills are built:

```
POST /skills/build → skill-engine:
  1. Parse OpenAPI spec → create SkillTool records
  2. discoverLinkedDocs() → upsert DomainKnowledge.docIndex
  3. generatePlaybooks()  → upsert DomainKnowledge.playbooks + entityGraph
```

The entity graph is generated by the LLM analysing the API's entity model from the spec. Playbooks are generated by the LLM analysing discovered documentation pages for complex multi-step workflows.

For existing skills built before domain intelligence was introduced, use:

```bash
POST /skills/:id/generate-playbooks
```

---

## Runtime Injection Flow

```
Orchestrator.execute(agentId, input)
  │
  ├── Load agent skills → get domain names (e.g. "extremecloudiq")
  │
  ├── Fetch DomainKnowledge for each domain
  │
  ├── Always inject: entityGraph (serialised to compact string)
  │
  └── For each playbook:
        tokenise(input) ∩ triggerPatterns → if ≥2 matches:
          inject playbook steps into system prompt
```

The enriched system prompt looks like:

```
[Agent charter mandate]

[Skill system prompts + learnedNotes]

## Domain Entity Graph (extremecloudiq)
Client(mac_address) → AP(ap_id) → Location(location_id)
VLAN(vlan_id) → Policy
Recipe: subnet_inference — Use ip_address + prefix_length to compute CIDR

## Analysis Playbook: radio-quality-by-location
Analyse radio signal quality grouped by location.
Steps:
1. Fetch all locations: GET /locations
2. For each location_id, fetch APs: GET /aps?location_id={id}
...

[Agent memory]
```

---

## Seeded XIQ Domain Knowledge

XIQ domain knowledge is pre-seeded by `npm run db:seed` with:

**Entity graph:**
- `Client(mac_address) → AP(ap_id) → Location(location_id)`
- `VLAN(vlan_id) → Policy`
- Recipe: `subnet_inference` — compute CIDR from ip_address + prefix_length
- Recipe: `telemetry_extraction` — fetch /monitor/radios for signal/interference data

**4 playbooks:**
- `radio-quality-by-location` — radio signal analysis grouped by location
- `vlan-ip-range-mapping` — VLAN ID to IP subnet/gateway mapping
- `client-health-overview` — aggregate client connectivity health metrics
- `new-device-detection` — compare current clients to agent memory to find new devices

---

## Dashboard: Domain Intel Page

The **Domain Intel** page (`/domains`) in the dashboard provides:

- **Domain list** — all domains with populated knowledge
- **Doc index** — table of all discovered documentation pages with categories and links
- **Entity graph editor** — JSON editor for the entity relationship graph
- **Playbook editor** — add, edit, or delete analysis playbooks

---

## API Reference

```bash
# List all domains with knowledge
GET /domains

# Get full knowledge for a domain
GET /domains/:domain/knowledge

# Replace all knowledge (entity graph + playbooks + docIndex)
PUT /domains/:domain/knowledge
Content-Type: application/json
{
  "entityGraph": { ... },
  "playbooks": [ ... ],
  "docIndex": [ ... ]
}

# Add or update playbooks only (merges by name)
PATCH /domains/:domain/knowledge/playbooks
Content-Type: application/json
{
  "playbooks": [
    {
      "name": "my-new-playbook",
      "description": "...",
      "triggerPatterns": ["word1", "word2"],
      "steps": ["1. ...", "2. ..."]
    }
  ]
}

# Retroactively generate playbooks for an existing skill
POST /skills/:id/generate-playbooks
```

---

## Adding Custom Playbooks

For any complex query pattern that your agents handle repeatedly, add a playbook:

```bash
curl -X PATCH http://localhost:4000/domains/extremecloudiq/knowledge/playbooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "playbooks": [
      {
        "name": "ap-channel-utilisation",
        "description": "Show channel utilisation and congestion per AP",
        "triggerPatterns": ["channel", "utilisation", "utilization", "congestion", "airtime"],
        "steps": [
          "1. Fetch all APs: GET /aps",
          "2. For each ap_id, fetch radio details: GET /monitor/radios?ap_ids={id}",
          "3. Extract: channel, channel_utilization_pct, tx_bytes, rx_bytes",
          "4. Sort by channel_utilization_pct descending",
          "5. Flag APs with utilization > 70% as congested",
          "6. Present as table: AP | Channel | Utilisation | Status"
        ]
      }
    ]
  }'
```

The playbook is active immediately for all subsequent agent requests.

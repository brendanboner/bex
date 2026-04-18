# Tool Router

The tool router solves a fundamental problem with large skill libraries: OpenAI's API limits tool arrays to 128 entries, but a fully-loaded Forge instance has 500–600 tools across all skills.

The router uses domain classification, intent detection, and availability gating to select the right 20–30 tools for each request — without the agent ever noticing the rest exist.

---

## The Problem

```
All skills loaded:  ~588 tools
OpenAI limit:        128 tools
Naive approach:     ❌ crashes with "array too long" error
Router approach:    ✅ 25 contextually relevant tools selected per request
```

---

## How It Works

```
User message
     │
     ▼
┌────────────────────────────────┐
│  1. Domain Classification      │
│  Score message against         │
│  keyword maps for each domain  │
│  XIQ | XCO | weather | utility │
└────────────┬───────────────────┘
             │ winning domain(s)
             ▼
┌────────────────────────────────┐
│  2. Intent Tier Detection      │
│  T1 = read/list/show/find      │
│  T2 = create/update/configure  │
│  T3 = delete/remove/purge      │
└────────────┬───────────────────┘
             │ tier 1/2/3
             ▼
┌────────────────────────────────┐
│  3. Availability Gating        │
│  Skip domains with unreachable │
│  base URLs (cached 5 min)      │
└────────────┬───────────────────┘
             │ available tools
             ▼
┌────────────────────────────────┐
│  4. Tier-Capped Selection      │
│  T1: 25 read tools             │
│  T2: +20 write tools           │
│  T3: +10 destructive tools     │
└────────────┬───────────────────┘
             │
             ▼
         LLM call
    (25–55 tools max)
```

---

## Domain Definitions

Each domain has positive term maps (words that indicate this domain) and negative terms (words that indicate a different domain even if positive terms appear).

| Domain | Example positive terms | Example negative terms |
|---|---|---|
| ExtremeCloud IQ (XIQ) | xiq, extremecloud, ssid, wireless, ap, client, vlan | xco, fabric, clos |
| XCO | xco, fabric, clos, vxlan, spine, leaf, switch | cloud, wireless, ssid |
| Weather | weather, forecast, temperature, rain | — |
| Utility | ssh, exec, ping, http | — |

**Disambiguation example:** The word "fabric" is ambiguous (XIQ has "network fabric" concepts, XCO is literally a fabric controller). Resolution:
- `fabric` + `xco|clos|vxlan|spine|leaf` → XCO
- `fabric` + `wireless|ssid|ap|cloud` → XIQ
- `fabric` alone → highest other-signal domain wins

---

## Tier System

Tools are classified into 3 tiers based on their name prefix:

| Tier | Patterns | Example tools | When loaded |
|---|---|---|---|
| T1 (read) | `list_`, `get_`, `search_`, `check_`, `show_` | `list_devices`, `get_client` | Always |
| T2 (write) | `create_`, `update_`, `set_`, `assign_`, `enable_` | `create_vlan`, `update_ssid` | When message has write intent |
| T3 (destructive) | `delete_`, `remove_`, `purge_`, `reset_`, `wipe_` | `delete_device`, `remove_vlan` | When message has delete intent |

**Intent keywords:**
- Write intent: `create`, `add`, `configure`, `update`, `change`, `set`, `enable`, `disable`, `push`
- Delete intent: `delete`, `remove`, `purge`, `reset`, `wipe`, `clear`, `destroy`

---

## Context Continuity

The router uses the last 6 messages from the conversation to maintain domain lock. If the user has been discussing XIQ for 3 turns, a vague follow-up ("what about the clients?") correctly routes to XIQ rather than re-classifying from scratch.

```typescript
// Context window for domain continuity
const contextText = buildContextText(messages.slice(-6));
const domainScore = scoreDomain(def, contextText + ' ' + currentMessage);
```

---

## Availability Gating

Prevents hangs when a skill's base URL is on a private VPN or unreachable network. Before including tools from a domain, the router checks if the base URL is reachable (result cached for 5 minutes):

```
XIQ base URL (api.extremecloudiq.com) → reachable → include XIQ tools ✅
XCO base URL (xco.corp.internal)      → timeout   → skip XCO tools  ⚠️
```

The orchestrator logs: `588 total → 488 reachable → 25 selected`

---

## Routing Result

The router returns a `RoutingResult` object:

```typescript
interface RoutingResult {
  tools: ExtendedTool[];     // the selected tools (≤55)
  domains: string[];         // e.g. ["ExtremeCloud IQ (XIQ)"]
  tier: 1 | 2 | 3;          // intent tier detected
  reasoning: string;         // e.g. "Domain: XIQ (score=6) | Tier: 1 | 588→25"
}
```

The `reasoning` string is logged for every request, making it easy to debug why certain tools were or weren't selected.

---

## Tuning

To add a new domain or adjust keyword scoring, edit `DOMAIN_DEFS` in `packages/orchestrator/src/tool-router.ts`:

```typescript
const DOMAIN_DEFS: DomainDef[] = [
  {
    name: 'My New Domain',
    prefix: 'mynewdomain',
    positiveTerms: ['myterm', 'mytool', 'myplatform'],
    negativeTerms: ['competitor'],
    t1Cap: 20,   // max read tools
    t2Cap: 15,   // max write tools
    t3Cap: 8,    // max destructive tools
  },
  // ...existing domains
];
```

# Data Models

All platform state lives in PostgreSQL via Prisma ORM. The schema is at `packages/shared/prisma/schema.prisma`.

---

## Entity Relationship Overview

```
User
 └── AgentRequest (submitted requests)
 └── Credential (scoped credentials)

Agent
 ├── AgentSkill[] ──→ Skill
 ├── AgentCharter (behavioural constraints + posture)
 ├── Credential (assigned credential set)
 ├── AgentRequest[] (execution history)
 └── personaId? ──→ Persona (spawning origin)

Skill
 ├── AgentSkill[] ←── Agent (many-to-many)
 ├── SkillTool[] (tool definitions)
 ├── learnedNotes (accumulated runtime knowledge)
 └── SkillRegistryEntry (published to registry)

Credential
 ├── Agent[] (assigned to agents)
 └── credentialType (API_TOKEN | BASIC_AUTH | BEARER_TOKEN | SSH_KEY | OAUTH2_CLIENT)

ScheduledJob → Agent (runs agent on schedule)
Target (network devices, systems)
ApprovalRequest (pending human approvals)
Persona → Agent (spawned agent)
CoordinatorSession → Agent (routed agent)
DomainKnowledge (doc index + entity graph + playbooks per domain)
MeshEvent (AgentMesh observability log)
```

---

## Core Models

### Agent

The primary actor. An agent has an LLM configuration, set of skills, a charter defining allowed operations, and optionally an assigned credential.

```prisma
model Agent {
  id          String      @id @default(cuid())
  name        String
  description String?
  status      AgentStatus @default(DRAFT)  // DRAFT | ACTIVE | PAUSED | ARCHIVED
  isDefault   Boolean     @default(false)  // catch-all for unmatched requests

  // Behaviour
  llmProvider String      // openai | anthropic | azure-openai
  llmModel    String      // gpt-4o | claude-3-5-sonnet | etc.
  permissions String[]    // ["read:network", "write:network", "ssh:exec"]

  // Relationships
  agentSkills AgentSkill[]
  charter     AgentCharter?
  credentialId String?
  credential  Credential?
  requests    AgentRequest[]
  personaId   String?     // link to spawning Persona
  persona     Persona?    @relation(fields: [personaId], references: [id])
}
```

**Key fields:**
- `isDefault` — when `true`, this agent handles requests that do not match a specific agent. A "Forge Assistant" default agent is seeded on first run.
- `personaId` — set when the agent was spawned from a Persona; enforces one-agent-per-persona.
- `permissions` — controls what the agent is allowed to do. `ssh:exec` enables the SSH tool. `write:*` enables write-tier tool loading.

---

### Skill

A skill is a domain-specific capability package: a set of tools, a system prompt, and accumulated runtime knowledge.

```prisma
model Skill {
  id           String      @id @default(cuid())
  name         String
  domain       String      // e.g. "extremecloudiq.clients"
  version      String      // semver: "1.0.0"
  status       SkillStatus // DRAFT | PENDING_REVIEW | PUBLISHED | DEPRECATED

  capabilities String[]    // discoverable tags
  systemPrompt String?     // injected into LLM context when skill is active
  learnedNotes String?     // accumulated API quirks (appended by skill_add_note tool)

  tools        SkillTool[]
  requiresApprovalForWrites Boolean @default(true)
  source       String?     // OpenAPI spec URL this was built from
}
```

**`learnedNotes`** is the skill's runtime memory. Agents append notes here via the `skill_add_note` tool. On every subsequent request, these notes are injected into the system prompt so the agent does not repeat mistakes.

---

### SkillTool

Individual callable operations within a skill. Each maps to one HTTP call or SSH command.

```prisma
model SkillTool {
  id          String  @id @default(cuid())
  name        String  // snake_case, ≤64 chars — used as the LLM tool name
  description String  // shown to the LLM to guide selection
  handlerType String  // xciq_http_call | xco_http_call | public_http_call | ssh_exec
  config      Json    // { method, urlTemplate, loginUrl, isWrite, operationId }
  parameters  Json    // JSON Schema for tool arguments
  skillId     String
  skill       Skill
}
```

**Handler types:**
- `xciq_http_call` — ExtremeCloud IQ. Auto-handles OAuth2 token refresh.
- `xco_http_call` — XCO (private network). Checks reachability before calling.
- `public_http_call` — Generic HTTP with Bearer/Basic auth from credential vault.
- `ssh_exec` — SSH into target host. Requires `ssh:exec` permission.

---

### Credential

Encrypted credential sets. The vault service holds the decryption key; agents never see raw secrets.

```prisma
model Credential {
  id             String         @id @default(cuid())
  name           String
  credentialType CredentialType // API_TOKEN | BASIC_AUTH | BEARER_TOKEN | SSH_KEY | OAUTH2_CLIENT
  scope          CredentialScope // GLOBAL | AGENT | USER
  encryptedValue String         // AES-256-GCM JSON blob
}

enum CredentialType {
  API_TOKEN       // { apiKey: "..." }
  BASIC_AUTH      // { username: "...", password: "..." }
  BEARER_TOKEN    // { token: "..." }
  SSH_KEY         // { username: "...", privateKey: "...", passphrase?: "..." }
  OAUTH2_CLIENT   // { clientId: "...", clientSecret: "...", tokenUrl: "...", scope?: "..." }
}
```

---

### AgentCharter

Defines an agent's operating mandate, posture, and authority limits. Applied before every execution.

```prisma
model AgentCharter {
  id                  String   @id @default(cuid())
  agentId             String   @unique
  agent               Agent    @relation(...)

  mandate             String   // injected as part of every system prompt
  posture             String   // AUTONOMOUS | SUPERVISED | INTERACTIVE | DELIBERATE
  bearing             String   // ANALYTICAL | CONCISE | NARRATIVE | FORMAL
  verbosity           String   // TERSE | STANDARD | DETAILED

  conductBoundaries   String[] // action patterns always requiring human approval
                               // e.g. ["delete.*", "write:fabric-config"]
  escalationTriggers  String[] // conditions forcing immediate escalation
                               // e.g. ["severity:CRITICAL", "drift:fabric"]
  scopeLimits         Json?    // hard limits on scope of action (arbitrary JSON)
}
```

**Posture levels:**

| Posture | Behaviour |
|---|---|
| `AUTONOMOUS` | Acts independently; notifies on completion only |
| `SUPERVISED` | Plans independently; approval gates for writes and destructive ops |
| `INTERACTIVE` | Confirms before each significant action; presents decision options |
| `DELIBERATE` | Analysis and planning only; awaits explicit instruction before each step |

**Bearing** controls communication style; **verbosity** controls response detail level. Both are injected into the system prompt.

---

### AgentRequest

Every agent execution is tracked as a request.

```prisma
model AgentRequest {
  id          String        @id @default(cuid())
  agentId     String
  userId      String
  status      RequestStatus // QUEUED | PROCESSING | COMPLETED | FAILED | AWAITING_APPROVAL
  input       String
  output      String?
  channel     String        // telegram | teams | whatsapp | dashboard | api | scheduler
  createdAt   DateTime
  completedAt DateTime?
  error       String?
}
```

---

### Persona

A goal-based template for creating agents. The LLM generates the structured fields from a plain-text goal description.

```prisma
model Persona {
  id           String   @id @default(cuid())
  name         String
  goal         String   // plain-text goal description provided by user
  systemPrompt String   // LLM-generated system prompt
  tone         String   // e.g. "professional", "concise", "analytical"
  skills       String[] // suggested skill domains (e.g. ["extremecloudiq.*"])
  schedule     String?  // suggested cron expression (e.g. "0 * * * *")
  agentId      String?  // populated after POST /personas/:id/spawn
  createdAt    DateTime
}
```

Spawning a Persona creates an `ACTIVE` Agent and sets `Agent.personaId`. Attempting to spawn again returns the existing agent (duplicate guard).

---

### DomainKnowledge

Domain-level intelligence: documentation index, entity relationship graph, and analysis playbooks. Keyed by domain string (e.g. `"extremecloudiq"`). Auto-populated when skills are built; manually editable via the dashboard or API.

```prisma
model DomainKnowledge {
  domain      String   @id   // e.g. "extremecloudiq", "networking"
  docIndex    Json     @default([])   // DocRef[] — typed links to documentation pages
  entityGraph Json     @default({})   // entity relationship map injected into every prompt
  playbooks   Json     @default([])   // analysis playbooks; injected on trigger word match
  updatedAt   DateTime @updatedAt
}
```

**`DocRef` structure** (items in `docIndex`):
```ts
{
  url:      string;
  title:    string;
  category: "api_guide" | "cli" | "troubleshooting" | "release_notes" | "user_guide" | "other";
}
```

**Playbook structure** (items in `playbooks`):
```ts
{
  name:            string;   // e.g. "radio-quality-by-location"
  description:     string;
  triggerPatterns: string[]; // words that activate this playbook (≥2 must appear in query)
  steps:           string[]; // ordered step-by-step instructions for the LLM
}
```

See [Domain Intelligence](domain-intelligence.md) for full details.

---

### CoordinatorSession

Records a multi-agent routing decision made by the Coordinator.

```prisma
model CoordinatorSession {
  id        String   @id @default(cuid())
  input     String   // the user's query
  agentId   String   // the agent selected by AgentMesh
  channel   String   // api | telegram | teams | dashboard | scheduler
  createdAt DateTime
}
```

---

### ScheduledJob

Cron-based agent triggers. The scheduler worker runs these on schedule.

```prisma
model ScheduledJob {
  id      String   @id @default(cuid())
  name    String
  agentId String
  cron    String   // standard cron: "0 * * * *" = hourly
  input   String   // the message to send the agent
  enabled Boolean  @default(true)
  lastRun DateTime?
  nextRun DateTime?
}
```

If the agent's response starts with `[NO_CHANGE]`, the scheduler skips writing to agent memory and skips sending the notification — preventing alert fatigue for monitoring agents.

---

### Target

Network devices or systems the agent can interact with via SSH or API.

```prisma
model Target {
  id           String  @id @default(cuid())
  name         String
  hostname     String
  ipAddress    String?
  description  String?
  tags         String[]
  credentialId String?
  credential   Credential?
}
```

---

### MeshEvent

Observability log for inter-agent routing via AgentMesh.

```prisma
model MeshEvent {
  id        String  @id @default(cuid())
  type      String  // task_assigned | task_completed | alert | approval_needed
  fromAgent String?
  toAgent   String?
  payload   Json
  processed Boolean @default(false)
  createdAt DateTime
}
```

---

## Enums

```prisma
enum AgentStatus    { DRAFT ACTIVE PAUSED ARCHIVED }
enum SkillStatus    { DRAFT PENDING_REVIEW PUBLISHED DEPRECATED }
enum RequestStatus  { QUEUED PROCESSING COMPLETED FAILED AWAITING_APPROVAL }
enum CredentialType { API_TOKEN BASIC_AUTH BEARER_TOKEN SSH_KEY OAUTH2_CLIENT }
enum CredentialScope { GLOBAL AGENT USER }
```

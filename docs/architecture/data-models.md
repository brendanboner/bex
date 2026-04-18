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
 ├── AgentCharter (behavioral constraints)
 ├── Credential (assigned credential set)
 └── AgentRequest[] (execution history)

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
MeshEvent (inter-agent messages)
CoordinatorSession (multi-agent orchestration)
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

  // Behaviour
  persona     Json        // { name, tone, maxTokens, systemPrompt }
  llmProvider String      // openai | anthropic | azure-openai
  llmModel    String      // gpt-4o | claude-3-5-sonnet | etc.
  permissions String[]    // ["read:network", "write:network", "ssh:exec"]

  // Relationships
  agentSkills AgentSkill[]
  charter     AgentCharter?
  credentialId String?
  credential  Credential?
  requests    AgentRequest[]
}
```

**Key fields:**
- `permissions` — controls what the agent is allowed to do. `ssh:exec` enables the SSH tool. `write:*` enables write-tier tool loading.
- `credentialId` — the agent uses this credential set for all API calls. Credentials are decrypted at runtime by the vault service.

---

### Skill

A skill is a domain-specific capability package: a set of tools, a system prompt, and accumulated runtime knowledge.

```prisma
model Skill {
  id           String      @id @default(cuid())
  name         String
  domain       String      // e.g. "extremecloudiq.clients"
  version      String      // semver: "1.0.0"
  status       SkillStatus // DRAFT | ACTIVE | DEPRECATED

  capabilities String[]    // discoverable tags
  systemPrompt String?     // injected into LLM context when skill is active
  learnedNotes String?     // accumulated API quirks (appended by skill_add_note tool)

  tools        SkillTool[]
  requiresApprovalForWrites Boolean @default(true)
  source       String?     // OpenAPI spec URL this was built from
}
```

**`learnedNotes`** is the skill's runtime memory. Agents append notes here via the `skill_add_note` tool when they discover API behaviour that differs from documentation. On every subsequent request, these notes are injected into the system prompt so the agent doesn't repeat mistakes.

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

Defines what an agent is allowed to do. Applied before every execution.

```prisma
model AgentCharter {
  id          String  @id @default(cuid())
  agentId     String  @unique
  name        String
  description String?
  constraints Json    // allowed domains, operations, targets
  objectives  Json    // what the agent should accomplish
  escalation  Json    // when and how to escalate to human
}
```

Example constraints:
```json
{
  "allowedDomains": ["extremecloudiq.*"],
  "allowedOperations": ["read", "write"],
  "requireApprovalFor": ["delete", "bulk_update"],
  "maxTargets": 50
}
```

---

### AgentRequest

Every agent execution is tracked as a request.

```prisma
model AgentRequest {
  id        String        @id @default(cuid())
  agentId   String
  userId    String
  status    RequestStatus // QUEUED | PROCESSING | COMPLETED | FAILED | AWAITING_APPROVAL
  input     String
  output    String?
  channel   String        // telegram | teams | whatsapp | dashboard | api | scheduler
  createdAt DateTime
  completedAt DateTime?
  error     String?
}
```

---

### ScheduledJob

Cron-based agent triggers. The scheduler worker runs these on schedule.

```prisma
model ScheduledJob {
  id       String  @id @default(cuid())
  name     String
  agentId  String
  cron     String  // standard cron expression: "0 * * * *" = hourly
  input    String  // the message to send the agent
  enabled  Boolean @default(true)
  lastRun  DateTime?
  nextRun  DateTime?
}
```

---

### Target

Network devices or systems the agent can interact with via SSH or API.

```prisma
model Target {
  id          String  @id @default(cuid())
  name        String
  hostname    String
  ipAddress   String?
  description String?
  tags        String[]
  credentialId String?
  credential  Credential?
}
```

---

### MeshEvent

Inter-agent communication bus. Coordinator agents post tasks here; worker agents consume them.

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
enum SkillStatus    { DRAFT ACTIVE DEPRECATED }
enum RequestStatus  { QUEUED PROCESSING COMPLETED FAILED AWAITING_APPROVAL }
enum CredentialType { API_TOKEN BASIC_AUTH BEARER_TOKEN SSH_KEY OAUTH2_CLIENT }
enum CredentialScope { GLOBAL AGENT USER }
```

import { z } from 'zod';

// ─── Credential Type (declared early — used by skill + credential schemas) ────

export const CredentialTypeSchema = z.enum([
  'API_TOKEN',         // Single bearer/header token or API key
  'USERNAME_PASSWORD', // username + password (e.g. XCO REST API)
  'SSH_KEY',           // privateKey + optional passphrase
  'BASIC_AUTH',        // username + password sent as HTTP Basic Auth
  'OAUTH2_CLIENT',     // clientId + clientSecret + optional tokenUrl
  'USER_PREFERENCE',   // Arbitrary key/value preferences usable by agents
]);
export type CredentialType = z.infer<typeof CredentialTypeSchema>;

// ─── Agent ────────────────────────────────────────────────────────────────────

export const PersonaSchema = z.object({
  name: z.string().optional(),
  tone: z.enum(['formal', 'concise', 'friendly', 'technical']).optional(),
  maxTokens: z.number().int().positive().max(128_000).optional(),
  systemPromptOverride: z.string().optional(),
  safetyLevel: z.enum(['standard', 'strict', 'unrestricted']).default('standard'),
});

export const LlmConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'azure-openai']),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  extra: z.record(z.unknown()).optional(),
});

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  persona: PersonaSchema.optional(),
  llmProvider: z.enum(['openai', 'anthropic', 'azure-openai']).default('openai'),
  llmModel: z.string().default('gpt-4o'),
  llmConfig: LlmConfigSchema.partial().optional(),
  permissions: z.array(z.string()).default([]),
  skillIds: z.array(z.string()).default([]),
});

export const UpdateAgentSchema = CreateAgentSchema.partial();

// ─── Skill ────────────────────────────────────────────────────────────────────

export const ToolParameterSchema: z.ZodType<Record<string, unknown>> = z.record(z.unknown());

export const SkillToolSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z_][a-z0-9_]*$/),
  description: z.string().min(1).max(500),
  parameters: z.record(z.unknown()).default({}), // JSON Schema object; defaults to empty (no params)
  endpoint: z.string().url().optional(),
});

export const CreateSkillSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(\.[a-z0-9-]+)*$/),
  description: z.string().max(2000).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  capabilities: z.array(z.string()).min(1),
  tools: z.array(SkillToolSchema).default([]),
  systemPrompt: z.string().optional(),
  // Optional: credential type required by agents using this skill
  requiredCredentialType: CredentialTypeSchema.optional(),
});

export const UpdateSkillSchema = CreateSkillSchema.partial().omit({ domain: true });

// ─── Knowledge Source ─────────────────────────────────────────────────────────

export const AddKnowledgeSourceSchema = z.object({
  skillId: z.string().cuid(),
  type: z.enum(['OPENAPI_JSON', 'PDF', 'MARKDOWN', 'URL']),
  label: z.string().min(1).max(200),
  url: z.string().url().optional(),
  // rawContent provided as base64 for file uploads
  rawContentBase64: z.string().optional(),
});

// ─── Credential ───────────────────────────────────────────────────────────────

// Type-safe value shapes per credential type
const ApiTokenValue = z.object({
  token: z.string().min(1),
  headerName: z.string().optional(), // override default 'Authorization' header
});
const UsernamePasswordValue = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  domain: z.string().optional(), // optional Windows/AD domain
});
const SshKeyValue = z.object({
  privateKey: z.string().min(1),
  passphrase: z.string().optional(),
  username: z.string().optional(), // SSH username (can also come from Target)
});
const BasicAuthValue = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
const Oauth2ClientValue = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  tokenUrl: z.string().url().optional(),
  scopes: z.string().optional(),
});
const UserPreferenceValue = z.record(z.string()); // arbitrary key/value pairs

export const CredentialValueSchema = z.discriminatedUnion('credentialType', [
  z.object({ credentialType: z.literal('API_TOKEN'), value: ApiTokenValue }),
  z.object({ credentialType: z.literal('USERNAME_PASSWORD'), value: UsernamePasswordValue }),
  z.object({ credentialType: z.literal('SSH_KEY'), value: SshKeyValue }),
  z.object({ credentialType: z.literal('BASIC_AUTH'), value: BasicAuthValue }),
  z.object({ credentialType: z.literal('OAUTH2_CLIENT'), value: Oauth2ClientValue }),
  z.object({ credentialType: z.literal('USER_PREFERENCE'), value: UserPreferenceValue }),
]);

export const CreateCredentialSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  scope: z.enum(['USER', 'SYSTEM']),
  credentialType: CredentialTypeSchema.default('API_TOKEN'),
  // Raw value - validated by type, encrypted by credential-vault before storing
  value: z.record(z.string()),
  allowedAgentPermissions: z.array(z.string()).default([]),
});

// ─── Agent Request ────────────────────────────────────────────────────────────

export const CreateAgentRequestSchema = z.object({
  // 'default' is a special alias for the system default agent
  agentId: z.union([z.string().cuid(), z.literal('default')]),
  input: z.string().min(1).max(32_000),
  channel: z.enum(['api', 'telegram', 'teams', 'dashboard', 'whatsapp', 'scheduler']).default('api'),
});

// ─── Endpoint ─────────────────────────────────────────────────────────────────

export const EndpointSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  baseUrl: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  notes: z.string().optional(),
  // SSH fields (optional)
  sshEnabled: z.boolean().default(false),
  hostname: z.string().optional(),
  sshPort: z.number().int().min(1).max(65535).default(22),
  credentialId: z.string().optional(),
});

// ─── Scheduled Job ────────────────────────────────────────────────────────────

export const CreateScheduledJobSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  agentId: z.string().cuid(),
  cronExpr: z
    .string()
    .regex(/^(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)$/),
  input: z.string().min(1),
  enabled: z.boolean().default(true),
});

// ─── Target ───────────────────────────────────────────────────────────────────

export const CreateTargetSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  hostname: z.string().min(1),
  sshPort: z.number().int().min(1).max(65535).default(22),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  credentialId: z.string().optional(),
  apiBaseUrl: z.string().url().optional(),
});

export const UpdateTargetSchema = CreateTargetSchema.partial();

// ─── Agent Charter ────────────────────────────────────────────────────────────

export const AgentPostureSchema = z.enum(['AUTONOMOUS', 'SUPERVISED', 'INTERACTIVE', 'DELIBERATE']);
export const AgentBearingSchema = z.enum(['ANALYTICAL', 'CONCISE', 'NARRATIVE', 'FORMAL']);
export const AgentVerbositySchema = z.enum(['TERSE', 'STANDARD', 'DETAILED']);

export const AgentCharterSchema = z.object({
  mandate: z.string().min(1).max(2000),
  posture: AgentPostureSchema.default('SUPERVISED'),
  bearing: AgentBearingSchema.default('CONCISE'),
  verbosity: AgentVerbositySchema.default('STANDARD'),
  conductBoundaries: z.array(z.string()).default([]),
  escalationTriggers: z.array(z.string()).default([]),
  scopeLimits: z.record(z.unknown()).optional(),
});

export const UpdateAgentCharterSchema = AgentCharterSchema.partial();

// ─── Persona ──────────────────────────────────────────────────────────────────

export const GeneratePersonaSchema = z.object({
  goal: z.string().min(1).max(2000),
  domain: z.string().optional(),
  existingSkills: z.array(z.string()).optional(),
  schedule: z.string().optional().describe('Override cron expression (e.g. "0 * * * *") — if not provided, LLM infers from goal'),
});

export const SpawnPersonaSchema = z.object({
  ownerId: z.string().optional(), // defaults to authenticated user on the server
  name: z.string().optional(),
  llmProvider: z.enum(['openai', 'anthropic', 'azure-openai']).optional(),
  llmModel: z.string().optional(),
});

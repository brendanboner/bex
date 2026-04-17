import { z } from 'zod';

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

export const CreateCredentialSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  scope: z.enum(['USER', 'SYSTEM']),
  // Raw value - encrypted by credential-vault before storing
  value: z.record(z.string()),
  allowedAgentPermissions: z.array(z.string()).default([]),
});

// ─── Agent Request ────────────────────────────────────────────────────────────

export const CreateAgentRequestSchema = z.object({
  agentId: z.string().cuid(),
  input: z.string().min(1).max(32_000),
  channel: z.enum(['api', 'telegram', 'teams', 'dashboard', 'whatsapp', 'scheduler']).default('api'),
});

// ─── Endpoint ─────────────────────────────────────────────────────────────────

export const EndpointSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  baseUrl: z.string().url(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
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
});

export const SpawnPersonaSchema = z.object({
  ownerId: z.string().cuid(),
  name: z.string().optional(),
  llmProvider: z.enum(['openai', 'anthropic', 'azure-openai']).optional(),
  llmModel: z.string().optional(),
});

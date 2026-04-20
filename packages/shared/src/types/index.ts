import type { z } from 'zod';

import {
  type CreateAgentRequestSchema,
  type CreateAgentSchema,
  type CreateCredentialSchema,
  type CreateScheduledJobSchema,
  type CreateSkillSchema,
  type EndpointSchema,
  type LlmConfigSchema,
  type PersonaSchema,
  type SkillToolSchema,
} from '../schemas/index.js';

// ─── Derived types from Zod schemas ───────────────────────────────────────────

export type Persona = z.infer<typeof PersonaSchema>;
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type SkillTool = z.infer<typeof SkillToolSchema>;
export type CreateSkillInput = z.infer<typeof CreateSkillSchema>;
export type CreateCredentialInput = z.infer<typeof CreateCredentialSchema>;
export type CreateAgentRequestInput = z.infer<typeof CreateAgentRequestSchema>;
export type CreateEndpointInput = z.infer<typeof EndpointSchema>;
export type CreateScheduledJobInput = z.infer<typeof CreateScheduledJobSchema>;

// ─── API Response envelope ────────────────────────────────────────────────────

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── LLM provider config ─────────────────────────────────────────────────────

export type LlmProvider = 'openai' | 'anthropic' | 'azure-openai' | 'ollama';

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
};

export type LlmToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

// ─── Orchestration ────────────────────────────────────────────────────────────

export type ExecutionContext = {
  requestId: string;
  agentId: string;
  userId: string;
  channel: 'api' | 'telegram' | 'teams' | 'whatsapp' | 'dashboard' | 'scheduler';
  input: string;
};

export type ToolCallResult = {
  toolCallId: string;
  toolName: string;
  result: unknown;
  error?: string;
};

// ─── Approval ─────────────────────────────────────────────────────────────────

export type ApprovalChannel = 'telegram' | 'teams' | 'whatsapp';

export type ApprovalPayload = {
  requestId: string;
  agentName: string;
  userId: string;
  reason: string;
  channel: ApprovalChannel;
  expiresAt: Date;
};

// ─── Credential Proxy ─────────────────────────────────────────────────────────

export type CredentialValues = Record<string, string>;

/** Describes how a credential's value should be injected into an HTTP request. */
export type CredentialInjection =
  | { type: 'bearer' }
  | { type: 'header'; key: string }
  | { type: 'query'; key: string }
  | { type: 'basic' }
  | { type: 'auto' }; // auto-infer from credentialType (API_TOKEN→bearer, USERNAME_PASSWORD→basic, etc.)

export type ProxiedRequestConfig = {
  credentialId: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  injection: CredentialInjection;
};

export type ProxiedRequestResult = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

// ─── Skill Discovery ──────────────────────────────────────────────────────────

export type SkillDiscoveryRequest = {
  intent: string;          // Natural language description of the needed capability
  domain?: string;         // Optional domain hint
  knowledgeSources?: Array<{
    type: 'OPENAPI_JSON' | 'PDF' | 'MARKDOWN' | 'URL';
    content: string;       // Raw content or URL
  }>;
};

export type SkillDiscoveryResult = {
  skill: CreateSkillInput;
  confidence: number;      // 0-1
  sourcesUsed: string[];
};

// ─── Monitoring ───────────────────────────────────────────────────────────────

export type AlarmSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'WARNING' | 'INFO';

export type Alarm = {
  id: string;
  severity: AlarmSeverity;
  description: string;
  source?: string;
  raisedAt?: string;
};

export type DriftItem = {
  component: string;
  expected: string;
  actual: string;
};

export type MonitoringResult = {
  healthy: boolean;
  alarms: Alarm[];
  drift: boolean;
  driftItems: DriftItem[];
  summary: string;
  checkedAt: string;
};

// ─── Skill Registry ───────────────────────────────────────────────────────────

export type SkillManifestKnowledgeDoc = {
  domain: string;
  topic: string;
  content: string;
};

export type SkillManifest = {
  name: string;
  domain: string;
  version: string;
  description?: string;
  capabilities: string[];
  tools: unknown[];
  systemPrompt?: string;
  checksum: string;
  publishedBy?: string;
  publishedAt: string;
  /** Optional knowledge docs bundled with this skill — installed into KnowledgeStore on pull */
  knowledgeDocs?: SkillManifestKnowledgeDoc[];
};

// ─── Agent Charter ────────────────────────────────────────────────────────────

export type AgentPosture = 'AUTONOMOUS' | 'SUPERVISED' | 'INTERACTIVE' | 'DELIBERATE';
export type AgentBearing = 'ANALYTICAL' | 'CONCISE' | 'NARRATIVE' | 'FORMAL';
export type AgentVerbosity = 'TERSE' | 'STANDARD' | 'DETAILED';

export type AgentCharterInput = {
  mandate: string;
  posture: AgentPosture;
  bearing: AgentBearing;
  verbosity: AgentVerbosity;
  conductBoundaries: string[];
  escalationTriggers: string[];
  scopeLimits?: Record<string, unknown>;
};

export type AgentCharterRecord = AgentCharterInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

// Resolved charter with defaults applied — safe to pass to orchestrator
export type ResolvedCharter = {
  mandate: string;
  posture: AgentPosture;
  bearing: AgentBearing;
  verbosity: AgentVerbosity;
  conductBoundaries: string[];
  escalationTriggers: string[];
  scopeLimits: Record<string, unknown>;
};

export const DEFAULT_CHARTER: ResolvedCharter = {
  mandate: 'Assist users with their requests accurately and safely.',
  posture: 'SUPERVISED',
  bearing: 'CONCISE',
  verbosity: 'STANDARD',
  conductBoundaries: ['delete.*', 'write:config', 'ssh:exec:reboot', 'ssh:exec:shutdown'],
  escalationTriggers: ['severity:CRITICAL', 'error_rate > 0.5'],
  scopeLimits: {},
};

import type { z } from 'zod';

import type {
  CreateAgentRequestSchema,
  CreateAgentSchema,
  CreateCredentialSchema,
  CreateScheduledJobSchema,
  CreateSkillSchema,
  EndpointSchema,
  LlmConfigSchema,
  PersonaSchema,
  SkillToolSchema,
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

export type LlmProvider = 'openai' | 'anthropic' | 'azure-openai';

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

export type ProxiedRequestConfig = {
  credentialId: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  // How the credential is injected: header key, query param, or bearer token
  injection:
    | { type: 'bearer' }
    | { type: 'header'; key: string }
    | { type: 'query'; key: string }
    | { type: 'basic' };
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
};

import { z } from 'zod';
import type { CoreTool } from 'ai';
import type { PrismaClient } from '@prisma/client';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { WorkflowPlanner } from './planner.js';
import { SkillBuilderService } from '@bex/skill-engine';

export type EnqueueRequestFn = (data: {
  requestId: string;
  agentId: string;
  userId: string;
  input: string;
  channel: string;
}) => Promise<void>;

async function resolveSystemLlmProvider(prisma: PrismaClient): Promise<{ provider: string; model: string }> {
  try {
    const cfg = await prisma.lLMConfig.findFirst({ where: { isDefault: true } });
    if (cfg) return { provider: cfg.provider, model: cfg.model };
  } catch { /* fall through */ }
  return {
    provider: process.env['LLM_PROVIDER'] ?? 'openai',
    model: process.env['LLM_MODEL'] ?? 'gpt-4o',
  };
}

// ─── list_agents ─────────────────────────────────────────────────────────────

export function makeListAgentsTool(prisma: PrismaClient): CoreTool {
  return {
    description: 'List all ACTIVE agents with their skills and capabilities',
    parameters: z.object({
      domain: z.string().optional().describe('Optional domain filter (substring match on skill domain)'),
    }),
    execute: async ({ domain }: { domain?: string }) => {
      const agents = await prisma.agent.findMany({
        where: {
          status: 'ACTIVE',
          ...(domain !== undefined
            ? { agentSkills: { some: { skill: { domain: { contains: domain } } } } }
            : {}),
        },
        include: {
          agentSkills: {
            include: {
              skill: { select: { id: true, name: true, domain: true, capabilities: true } },
            },
          },
        },
      });
      return { agents };
    },
  };
}

// ─── spawn_agent ──────────────────────────────────────────────────────────────

export function makeSpawnAgentTool(prisma: PrismaClient, enqueueRequest?: EnqueueRequestFn): CoreTool {
  return {
    description:
      'Spawn a new AgentRequest from an existing Agent (by agentId) or create one from a matching Persona (by goal).',
    parameters: z.object({
      agentId: z.string().optional().describe('Existing agent ID to spawn a request from'),
      goal: z.string().optional().describe('Natural-language goal — used to find a matching Persona when agentId is omitted'),
      input: z.string().describe('The task input to send to the agent'),
      channel: z.string().optional().describe('Channel override (default: api)'),
    }),
    execute: async ({
      agentId,
      goal,
      input,
      channel,
    }: {
      agentId?: string;
      goal?: string;
      input: string;
      channel?: string;
    }) => {
      const systemUser = await prisma.user.findFirst({
        where: { isSystemUser: true },
        select: { id: true },
      });
      const userId = systemUser?.id ?? 'system';

      let resolvedAgentId = agentId;

      if (resolvedAgentId === undefined && goal !== undefined) {
        const persona = await prisma.persona.findFirst({
          where: { goal: { contains: goal } },
          select: { id: true, name: true, systemPrompt: true, requiredSkills: true, suggestedPermissions: true },
        });

        if (persona === null) {
          return { error: `No persona found matching goal: ${goal}` };
        }

        const owner = await prisma.user.findFirst({
          where: { isSystemUser: true },
          select: { id: true },
        });
        if (owner === null) return { error: 'No system user found to own the spawned agent' };

        const newAgent = await prisma.agent.create({
          data: {
            name: persona.name,
            status: 'ACTIVE',
            persona: {},
            ...await resolveSystemLlmProvider(prisma).then(llm => ({ llmProvider: llm.provider, llmModel: llm.model })),
            llmConfig: {},
            permissions: persona.suggestedPermissions,
            ownerId: owner.id,
            personaId: persona.id,
          },
          select: { id: true },
        });
        resolvedAgentId = newAgent.id;
      }

      if (resolvedAgentId === undefined) {
        return { error: 'Either agentId or goal must be provided' };
      }

      const request = await prisma.agentRequest.create({
        data: {
          agentId: resolvedAgentId,
          userId,
          status: 'QUEUED',
          input,
          channel: channel ?? 'api',
        },
        select: { id: true, status: true },
      });

      if (enqueueRequest) {
        try {
          await enqueueRequest({ requestId: request.id, agentId: resolvedAgentId, userId, input, channel: channel ?? 'api' });
        } catch (e) {
          await prisma.agentRequest.update({ where: { id: request.id }, data: { status: 'FAILED', output: `Enqueue failed: ${(e as Error).message}` } });
          return { error: `Failed to enqueue request: ${(e as Error).message}` };
        }
      }

      return { requestId: request.id, status: request.status };
    },
  };
}

// ─── delegate_task ────────────────────────────────────────────────────────────

export function makeDelegateTaskTool(prisma: PrismaClient, enqueueRequest?: EnqueueRequestFn): CoreTool {
  return {
    description:
      'Delegate a sub-task to a specific agent. Quick-polls for up to 10 s — if the agent finishes in time the result is returned immediately. If still running, returns { requestId, status: "PENDING" } so you can tell the user you\'ve started the task and they can ask for an update (use check_task_status to follow up).',
    parameters: z.object({
      agentId: z.string().describe('ID of the agent to delegate the task to'),
      task: z.string().describe('The task description / input for the agent'),
      channel: z.string().optional().describe('Channel override (default: api)'),
    }),
    execute: async ({ agentId, task, channel }: { agentId: string; task: string; channel?: string }) => {
      const systemUser = await prisma.user.findFirst({
        where: { isSystemUser: true },
        select: { id: true },
      });
      const userId = systemUser?.id ?? 'system';

      const request = await prisma.agentRequest.create({
        data: {
          agentId,
          userId,
          status: 'QUEUED',
          input: task,
          channel: channel ?? 'api',
        },
        select: { id: true },
      });

      if (enqueueRequest) {
        try {
          await enqueueRequest({ requestId: request.id, agentId, userId, input: task, channel: channel ?? 'api' });
        } catch (e) {
          await prisma.agentRequest.update({ where: { id: request.id }, data: { status: 'FAILED', output: `Enqueue failed: ${(e as Error).message}` } });
          return { requestId: request.id, error: `Failed to enqueue task: ${(e as Error).message}` };
        }
      }

      // Quick-poll: wait up to 10 s for a fast response. If not done, return PENDING
      // so the coordinator can tell the user to ask for an update via check_task_status.
      try {
        const result = await pollForCompletion(prisma, request.id, 10_000);
        return { requestId: request.id, output: result };
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('timed out')) {
          return { requestId: request.id, status: 'PENDING' };
        }
        return { requestId: request.id, error: msg };
      }
    },
  };
}

// ─── check_task_status ────────────────────────────────────────────────────────

export function makeCheckTaskStatusTool(prisma: PrismaClient): CoreTool {
  return {
    description:
      'Check the status of a previously delegated task by its requestId. Waits up to 15 s for completion. Use this when a delegate_task returned { status: "PENDING" } and the user asks for an update.',
    parameters: z.object({
      requestId: z.string().describe('The requestId returned by a previous delegate_task call'),
    }),
    execute: async ({ requestId }: { requestId: string }) => {
      try {
        const result = await pollForCompletion(prisma, requestId, 15_000);
        return { requestId, status: 'COMPLETED', output: result };
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('timed out')) {
          return { requestId, status: 'PENDING', message: 'Still processing — check again shortly.' };
        }
        return { requestId, status: 'FAILED', error: msg };
      }
    },
  };
}

async function pollForCompletion(
  prisma: PrismaClient,
  requestId: string,
  timeoutMs: number = 60_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const intervalMs = 2_000;

  while (Date.now() < deadline) {
    const req = await prisma.agentRequest.findUnique({
      where: { id: requestId },
      select: { status: true, output: true },
    });

    if (req === null) throw new Error(`AgentRequest ${requestId} not found`);

    if (req.status === 'COMPLETED') return req.output ?? '';
    if (req.status === 'FAILED' || req.status === 'CANCELLED') {
      throw new Error(`AgentRequest ${requestId} ended with status ${req.status}`);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`AgentRequest ${requestId} timed out after ${timeoutMs}ms`);
}

// ─── check_domain_constraint ──────────────────────────────────────────────────

export function makeCheckConstraintTool(prisma: PrismaClient): CoreTool {
  return {
    description: 'Check compatibility between two domain skill sets (e.g. can XIQ + XCO data be combined?)',
    parameters: z.object({
      sourceDomain: z.string().describe('Source domain (e.g. networking.extreme-xiq)'),
      targetDomain: z.string().describe('Target domain (e.g. networking.extreme-xco)'),
    }),
    execute: async ({ sourceDomain, targetDomain }: { sourceDomain: string; targetDomain: string }) => {
      const constraint = await prisma.domainConstraint.findFirst({
        where: { sourceDomain, targetDomain },
        select: { compatible: true, notes: true, conditions: true },
      });

      if (constraint === null) {
        return { found: false, compatible: 'UNKNOWN', notes: null };
      }

      return {
        found: true,
        compatible: constraint.compatible,
        notes: constraint.notes ?? null,
        conditions: constraint.conditions ?? null,
      };
    },
  };
}

// ─── plan_workflow ────────────────────────────────────────────────────────────

export function makePlanWorkflowTool(_prisma: PrismaClient): CoreTool {
  return {
    description:
      'Decompose a multi-domain goal into an ordered sub-task plan with dependency graph. Does NOT execute — planning only.',
    parameters: z.object({
      goal: z.string().describe('The multi-domain goal to decompose'),
      availableCapabilities: z.array(z.string()).optional().describe('Known capability strings available in the mesh'),
    }),
    execute: async ({
      goal,
      availableCapabilities,
    }: {
      goal: string;
      availableCapabilities?: string[];
    }) => {
      const planner = new WorkflowPlanner();
      const plan = await planner.plan(goal, availableCapabilities ?? []);
      return plan;
    },
  };
}

// ─── read_knowledge ───────────────────────────────────────────────────────────

export function makeReadKnowledgeTool(knowledgeDir: string): CoreTool {
  return {
    description: 'Read a markdown knowledge file: knowledge/{domain}/{topic}.md',
    parameters: z.object({
      domain: z.string().describe('Knowledge domain folder (e.g. networking.extreme-xco)'),
      topic: z.string().describe('Topic filename without .md extension'),
    }),
    execute: async ({ domain, topic }: { domain: string; topic: string }) => {
      const filePath = join(knowledgeDir, domain, `${topic}.md`);
      try {
        const content = await readFile(filePath, 'utf-8');
        return { found: true, content };
      } catch {
        return { found: false, content: null };
      }
    },
  };
}

// ─── write_knowledge ──────────────────────────────────────────────────────────

export function makeWriteKnowledgeTool(knowledgeDir: string): CoreTool {
  return {
    description: 'Write or update a markdown knowledge file: knowledge/{domain}/{topic}.md',
    parameters: z.object({
      domain: z.string().describe('Knowledge domain folder (e.g. networking.extreme-xco)'),
      topic: z.string().describe('Topic filename without .md extension'),
      content: z.string().describe('Markdown content to write'),
    }),
    execute: async ({ domain, topic, content }: { domain: string; topic: string; content: string }) => {
      const filePath = join(knowledgeDir, domain, `${topic}.md`);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
      return { written: true, path: filePath };
    },
  };
}

// ─── list_knowledge_topics ────────────────────────────────────────────────────

export function makeListKnowledgeTopicsTool(knowledgeDir: string): CoreTool {
  return {
    description: 'List all knowledge files, optionally filtered by domain',
    parameters: z.object({
      domain: z.string().optional().describe('Optional domain folder to filter by'),
    }),
    execute: async ({ domain }: { domain?: string }) => {
      try {
        if (domain !== undefined) {
          const domainDir = join(knowledgeDir, domain);
          const files = await readdir(domainDir).catch(() => [] as string[]);
          return { topics: files.map((f) => ({ domain, topic: f.replace(/\.md$/, '') })) };
        }

        const domains = await readdir(knowledgeDir).catch(() => [] as string[]);
        const topics: Array<{ domain: string; topic: string }> = [];
        for (const d of domains) {
          const files = await readdir(join(knowledgeDir, d)).catch(() => [] as string[]);
          for (const f of files) {
            topics.push({ domain: d, topic: f.replace(/\.md$/, '') });
          }
        }
        return { topics };
      } catch {
        return { topics: [] };
      }
    },
  };
}

// ─── create_skill ────────────────────────────────────────────────────────────

export function makeCreateSkillTool(prisma: PrismaClient): CoreTool {
  return {
    description:
      'Build a new skill using the SkillBuilderService. Use when a capability gap is detected and a new skill must be created from knowledge sources.',
    parameters: z.object({
      domain: z.string().describe('Skill domain in reverse-DNS style (e.g. networking.extreme-xco)'),
      intent: z.string().describe('Natural-language description of what the skill should do'),
      sources: z
        .array(
          z.object({
            type: z.enum(['openapi_url', 'pdf_url', 'markdown_url', 'raw_markdown']),
            label: z.string(),
            url: z.string().optional(),
            content: z.string().optional(),
          }),
        )
        .optional()
        .describe('Optional knowledge sources for the skill builder'),
    }),
    execute: async ({
      domain,
      intent,
      sources,
    }: {
      domain: string;
      intent: string;
      sources?: Array<{ type: string; label: string; url?: string; content?: string }>;
    }) => {
      try {
        const builder = new SkillBuilderService(prisma);
        const result = await builder.build({
          domain,
          intent,
          sources: (sources ?? []).map((s) => ({
            type: s.type as 'openapi_url' | 'pdf_url' | 'markdown_url' | 'raw_markdown',
            label: s.label,
            ...(s.url !== undefined ? { url: s.url } : {}),
            ...(s.content !== undefined ? { content: s.content } : {}),
          })),
        });
        return { skillId: result.skillId, domain, intent };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e), domain, intent };
      }
    },
  };
}

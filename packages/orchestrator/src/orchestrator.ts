import type { CoreMessage, CoreTool } from 'ai';
import { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { z } from 'zod';
import { KnowledgeStore } from '@bclaw/knowledge-store';

import type { ExecutionContext, LlmProvider, SkillTool } from '@bclaw/shared';
import { ErrorCodes } from '@bclaw/shared';
import { CredentialVaultService } from '@bclaw/credential-vault';
import { SkillRegistryService, ToolRegistry } from '@bclaw/skill-engine';
import { PermissionGatewayService } from '@bclaw/permission-gateway';
import { SshExecutorService, createSshTool } from '@bclaw/ssh-executor';

import { buildLlmModel, buildTools, runLlm, getCachedReachability } from './llm-runner.js';
import { resolveCharter, buildCharterPrompt, isRestrictedAction } from './charter.js';
import { routeTools, filterUnavailableSkills, buildSkillDomainMap } from './tool-router.js';
import { buildSkillLearningTool, buildEnrichedSystemPrompt } from './skill-learning.js';

const knowledgeStore = new KnowledgeStore(process.env['KNOWLEDGE_BASE_DIR'] ?? './knowledge');

/** Load workspace docs for an agent and return a formatted prompt section. */
async function loadWorkspaceDocs(agentId: string): Promise<string> {
  const domain = `agent/${agentId}`;
  const [instructions, context, memory] = await Promise.all([
    knowledgeStore.read(domain, 'instructions').catch(() => null),
    knowledgeStore.read(domain, 'context').catch(() => null),
    knowledgeStore.read(domain, 'memory').catch(() => null),
  ]);
  const parts: string[] = [];
  if (instructions?.content) parts.push(`## Agent Instructions\n${instructions.content}`);
  if (context?.content) parts.push(`## Workspace Context\n${context.content}`);
  if (memory?.content) parts.push(`## Agent Memory\n${memory.content}`);
  return parts.join('\n\n');
}

/** Build a write_memory tool that persists notes to the agent's memory doc. */
function buildWriteMemoryTool(agentId: string): CoreTool {
  return tool({
    description: 'Persist important notes, observations, or facts to long-term agent memory. Call this when you want to remember something for future runs.',
    parameters: z.object({
      content: z.string().describe('The markdown content to save as agent memory. Append to existing notes rather than replacing unless asked to reset.'),
      mode: z.enum(['append', 'replace']).default('append').describe('append adds to existing memory; replace overwrites it'),
    }),
    execute: async ({ content, mode }) => {
      const domain = `agent/${agentId}`;
      if (mode === 'append') {
        const existing = await knowledgeStore.read(domain, 'memory').catch(() => null);
        const timestamp = new Date().toISOString();
        const newContent = existing?.content
          ? `${existing.content}\n\n<!-- ${timestamp} -->\n${content}`
          : `<!-- ${timestamp} -->\n${content}`;
        await knowledgeStore.write(domain, 'memory', newContent);
      } else {
        await knowledgeStore.write(domain, 'memory', content);
      }
      return { saved: true, mode };
    },
  });
}

/**
 * Thrown when a tool call needs approval before executing.
 * The job exits cleanly; the approval route re-enqueues when approved.
 */
export class ApprovalRequiredError extends Error {
  constructor(
    public readonly requestId: string,
    public readonly toolName: string,
    public readonly reason: string,
  ) {
    super(`Approval required for tool "${toolName}": ${reason}`);
    this.name = 'ApprovalRequiredError';
  }
}

export class OrchestratorService {
  private readonly vault: CredentialVaultService;
  private readonly skillRegistry: SkillRegistryService;
  private readonly permGateway: PermissionGatewayService;
  private readonly toolRegistry: ToolRegistry;
  private readonly sshExecutor: SshExecutorService;

  constructor(private readonly prisma: PrismaClient) {
    this.vault = new CredentialVaultService(prisma);
    this.skillRegistry = new SkillRegistryService(prisma);
    this.permGateway = new PermissionGatewayService(prisma);
    this.toolRegistry = new ToolRegistry(prisma);
    this.sshExecutor = new SshExecutorService(prisma, this.vault);
  }

  /**
   * Execute an agent request. Called by the BullMQ worker.
   *
   * Design contract:
   * - ALWAYS returns quickly (no long-polling).
   * - If a SUPERVISED action needs approval, sets status → AWAITING_APPROVAL and returns.
   * - The approval API re-enqueues the job; on re-run this method detects the prior approval
   *   and proceeds with execution.
   */
  async execute(ctx: ExecutionContext): Promise<{ output: string }> {
    // 1. Load agent definition
    const agent = await this.prisma.agent.findUnique({
      where: { id: ctx.agentId },
      include: { agentSkills: { include: { skill: true } } },
    });

    if (!agent) {
      throw Object.assign(new Error('Agent not found'), { code: ErrorCodes.NOT_FOUND });
    }

    // 2. Load charter (scalar charterId is always present on agent row)
    const charter = agent.charterId
      ? await this.prisma.agentCharter.findUnique({ where: { id: agent.charterId } })
      : null;
    const resolvedCharter = resolveCharter(charter);

    // 3. Check for prior approval (resume path after AWAITING_APPROVAL)
    const priorApproval = await this.permGateway.pollStatus(ctx.requestId);
    if (priorApproval === 'DENIED') {
      await this.prisma.agentRequest.update({
        where: { id: ctx.requestId },
        data: { status: 'FAILED', errorMsg: 'Request denied by approver', completedAt: new Date() },
      });
      return { output: 'This request was denied by an approver.' };
    }
    // priorApproval is 'APPROVED' | 'PENDING' | 'EXPIRED' | null
    // 'APPROVED' = resume after gate; 'EXPIRED' / 'PENDING' = still gated (abort softly)
    const isResuming = priorApproval === 'APPROVED';

    // 4. Update request status → RUNNING
    await this.prisma.agentRequest.update({
      where: { id: ctx.requestId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    try {
      // 5. Use agent's linked skills (agentSkills) as primary source; fall back to intent search
      const linkedSkills = agent.agentSkills.map((as) => as.skill);
      const skill =
        linkedSkills.length > 0
          ? linkedSkills[0]
          : await this.skillRegistry.findByIntent(ctx.input);

      // 6. Resolve a credential for proxied tool calls.
      // Priority: agent.credentialId (explicit named assignment) → permission-based fallback.
      let credentialRecord: { id: string } | null = null;
      if (agent.credentialId) {
        credentialRecord = { id: agent.credentialId };
      } else {
        credentialRecord = await this.prisma.credential.findFirst({
          where: {
            scope: 'SYSTEM',
            allowedAgentPermissions: { hasSome: agent.permissions.length > 0 ? agent.permissions : ['*'] },
          },
          select: { id: true },
        });
      }

      // 6b. Build per-skill credential map (domain → credentialId) for multi-domain agents.
      // Each skill may require a specific credential type (e.g. XCO needs USERNAME_PASSWORD).
      const domainCredMap: Record<string, string> = {};
      for (const s of linkedSkills) {
        if (!s.requiredCredentialType) continue;
        // Extract meaningful domain keyword to match credential by name.
        // Split by both '.' and '-' so "extreme-xco" yields ["extreme","xco"] → keyword "xco".
        const stopWords = new Set(['networking', 'monitoring', 'cloud', 'extreme', 'extremecloudiq', 'operations', 'monitor']);
        const keywords = s.domain.split('.').flatMap((k: string) => k.split('-')).filter((k: string) => !stopWords.has(k));
        const keyword = keywords[0];
        const cred = await this.prisma.credential.findFirst({
          where: {
            scope: 'SYSTEM',
            credentialType: s.requiredCredentialType as 'API_TOKEN' | 'USERNAME_PASSWORD' | 'SSH_KEY' | 'OAUTH2_CLIENT' | 'USER_PREFERENCE',
            ...(keyword ? { name: { contains: keyword, mode: 'insensitive' as const } } : {}),
          },
          select: { id: true },
        });
        if (cred) {
          domainCredMap[s.domain] = cred.id;
          console.info(`[orchestrator] Resolved credential for domain ${s.domain} → ${cred.id}`);
        }
      }

      // 6c. Resolve endpoint host map: Endpoint tags → baseUrl.
      // Uses smart routing: extract endpoint hints from user input, prefer matched endpoints.
      // e.g. Endpoint{tags:["xco"], baseUrl:"http://10.64.160.109"} → hostMap["xco-host"] = "http://10.64.160.109"
      const endpointRows = await this.prisma.endpoint.findMany({
        select: { name: true, tags: true, aliases: true, baseUrl: true },
      });

      // Smart endpoint resolution: match input against endpoint name/aliases/tags
      const inputLower = ctx.input.toLowerCase();
      const matchedEndpoint = endpointRows.find((ep) => {
        const candidates = [ep.name, ...ep.aliases, ...ep.tags].map((s) => s.toLowerCase());
        return candidates.some((c) => inputLower.includes(c));
      });

      const hostMap: Record<string, string> = {};
      for (const ep of endpointRows) {
        // If we matched a specific endpoint, only use that endpoint for its tags
        const useThisEp = !matchedEndpoint || matchedEndpoint.name === ep.name;
        if (useThisEp) {
          for (const tag of ep.tags) {
            hostMap[`${tag}-host`] = ep.baseUrl.replace(/\/$/, '');
          }
        }
      }
      // If no match, fallback to all endpoints (first one wins per tag)
      if (matchedEndpoint === undefined) {
        for (const ep of endpointRows) {
          for (const tag of ep.tags) {
            if (!hostMap[`${tag}-host`]) {
              hostMap[`${tag}-host`] = ep.baseUrl.replace(/\/$/, '');
            }
          }
        }
      }

      // 7. Build tool set — include tools from ALL linked skills with smart domain routing.
      // Pre-annotate each tool with its resolved endpoint URL and credential ID.
      const rawSkillTools: Array<Record<string, unknown>> = linkedSkills.flatMap((s) =>
        ((s.tools as Array<Record<string, unknown>>) ?? []).map((t) => ({
          ...t,
          _skillDomain: s.domain,
        })),
      );
      if (rawSkillTools.length === 0 && skill?.tools) {
        rawSkillTools.push(...(skill.tools as Array<Record<string, unknown>>));
      }

      // Substitute {tag-host} placeholders and inject per-domain credential IDs
      const resolveHostPlaceholders = (url: string): string => {
        // First: replace `https://{tag-host}` or `http://{tag-host}` as a unit,
        // so the configured protocol (e.g. http://) overrides the skill template's protocol.
        let resolved = url.replace(/https?:\/\/\{([^}]+)\}/g, (_, key: string) => hostMap[key] ?? `https://{${key}}`);
        // Second pass: replace any bare `{tag-host}` placeholders (no protocol prefix)
        resolved = resolved.replace(/\{([^}]+)\}/g, (full, key: string) => {
          if (key in hostMap) return (hostMap[key] ?? '').replace(/^https?:\/\//, '');
          return full;
        });
        return resolved;
      };

      const allSkillTools = rawSkillTools.map((tool) => {
        const domain = tool['_skillDomain'] as string | undefined;
        const resolved = { ...tool };
        delete resolved['_skillDomain'];

        // Resolve {tag-host} in endpoint and config.urlTemplate
        if (typeof resolved['endpoint'] === 'string') {
          resolved['endpoint'] = resolveHostPlaceholders(resolved['endpoint']);
        }
        const cfg = resolved['config'] as Record<string, unknown> | undefined;
        if (cfg && typeof cfg['urlTemplate'] === 'string') {
          resolved['config'] = { ...cfg, urlTemplate: resolveHostPlaceholders(cfg['urlTemplate']) };
        }

        // Embed domain credential so buildTools can use it for http_call
        const domainCred = domain ? domainCredMap[domain] : undefined;
        if (domainCred) {
          resolved['config'] = { ...(resolved['config'] as Record<string, unknown> ?? {}), resolvedCredentialId: domainCred };
        }

        return resolved;
      });

      // Build a map of tool name → skill domain for the router
      const skillDomainMap = buildSkillDomainMap(
        linkedSkills.map((s) => ({ domain: s.domain, tools: s.tools })),
      );

      // Apply availability gating — skip entire domains whose endpoints are unreachable
      const { tools: reachableTools, skippedDomains } = filterUnavailableSkills(
        allSkillTools as SkillTool[],
        skillDomainMap,
        getCachedReachability,
      );
      if (skippedDomains.length > 0) {
        console.info(`[orchestrator] Skipped unreachable skill domains: ${skippedDomains.join(', ')}`);
      }

      // Use the smart tool router: domain classification + tiered progressive loading.
      // Always stays within OpenAI's 128-tool limit (defaults to max 55 tools).
      const MAX_TOOLS = 55;
      const routingResult = routeTools(reachableTools, skillDomainMap, {
        query: ctx.input,
        maxTools: MAX_TOOLS,
      });
      const selectedSkillTools = routingResult.tools;

      console.info(`[orchestrator] ${routingResult.reasoning}`);
      console.info(`[orchestrator] ${allSkillTools.length} total → ${reachableTools.length} reachable → ${selectedSkillTools.length} selected`);
      if (selectedSkillTools.length > 0) {
        const topNames = (selectedSkillTools as SkillTool[]).slice(0, 8).map((t: SkillTool) => t.name).join(', ');
        console.info(`[orchestrator] Top selected tools: ${topNames}`);
      }

      await this.toolRegistry.load();
      const dynamicTools = this.toolRegistry.getAll();

      const sshTool = agent.permissions.includes('ssh:exec')
        ? { ssh_exec: createSshTool(this.sshExecutor, this.prisma) }
        : {};

      // skill_add_note — always available so agent can persist discovered API quirks
      const learningTool = buildSkillLearningTool(
        this.prisma,
        linkedSkills.map((s) => s.domain),
      );

      const rawTools = { ...dynamicTools, ...sshTool, ...learningTool, ...buildTools(selectedSkillTools as SkillTool[], this.vault, agent.permissions, credentialRecord?.id) };

      // Build a lookup for whether each tool is a write op (from skill tool config).
      const writeToolNames = new Set(
        (selectedSkillTools as Array<{ name?: string; config?: { isWrite?: boolean } }>)
          .filter((t) => t.config?.isWrite === true)
          .map((t) => t.name)
          .filter(Boolean) as string[],
      );

      // For SUPERVISED posture: wrap write tools with an approval gate.
      // Read tools execute freely. Explicitly restricted tools (conductBoundaries) are always gated.
      // If a restricted tool is called without prior approval, we abort and request it.
      const tools: Record<string, CoreTool> = {};
      for (const [name, tool] of Object.entries(rawTools)) {
        const restricted = isRestrictedAction(name, resolvedCharter) ||
          (resolvedCharter.posture === 'SUPERVISED' && writeToolNames.has(name));
        if (restricted && !isResuming) {
          tools[name] = {
            ...tool,
            execute: async (args: Record<string, unknown>): Promise<unknown> => {
              // Request approval asynchronously — abort current execution path
              const approvalChannel = (process.env['DEFAULT_APPROVAL_CHANNEL'] ?? 'api') as 'telegram' | 'teams' | 'api';
              await this.permGateway.requestApproval(
                ctx.requestId,
                agent.name,
                ctx.userId,
                `Agent "${agent.name}" wants to run tool "${name}" with args: ${JSON.stringify(args)}`,
                approvalChannel === 'api' ? 'telegram' : approvalChannel,
              );
              throw new ApprovalRequiredError(ctx.requestId, name, JSON.stringify(args));
            },
          } as CoreTool;
        } else {
          tools[name] = tool;
        }
      }

      // 8. Build LLM model and system prompt
      // Prefer default LLMConfig from DB over env vars if configured
      let llmApiKey: string | undefined;
      let llmBaseUrl: string | undefined;
      let llmProvider = agent.llmProvider as LlmProvider;
      let llmModel = agent.llmModel;

      try {
        const defaultConfig = await this.prisma.lLMConfig.findFirst({
          where: { isDefault: true },
          include: { credential: { select: { id: true } } },
        });
        if (defaultConfig) {
          llmProvider = defaultConfig.provider as LlmProvider;
          llmModel = defaultConfig.model;
          if (defaultConfig.credentialId) {
            const cred = await this.vault.resolve(defaultConfig.credentialId, []);
            llmApiKey = (cred as { apiKey?: string }).apiKey;
          }
          if (defaultConfig.baseUrl) {
            llmBaseUrl = defaultConfig.baseUrl;
          }
        }
      } catch {
        // Fall through to env-var based config
      }

      const model = buildLlmModel(llmProvider, llmModel, llmApiKey, llmBaseUrl);

      const charterPrompt = buildCharterPrompt(resolvedCharter);
      const personaData = agent.persona as { systemPromptOverride?: string; systemPrompt?: string } | null;
      const personaPrompt = personaData?.systemPromptOverride ?? personaData?.systemPrompt ?? '';
      // Collect system prompts from all linked skills (not just the first)
      const skillSystemPrompts = linkedSkills.map((s) => s.systemPrompt).filter(Boolean).join('\n\n');
      const baseSkillPrompt = skillSystemPrompts || (skill?.systemPrompt ?? '');

      // Enrich base prompt with learnedNotes — accumulated API quirks from real interactions
      const enrichedSkillPrompt = buildEnrichedSystemPrompt(
        baseSkillPrompt,
        linkedSkills.map((s) => ({ domain: s.domain, learnedNotes: (s as typeof s & { learnedNotes?: string | null }).learnedNotes })),
      );

      // Load agent workspace docs (instructions, context, memory) from KnowledgeStore
      const workspaceDocs = await loadWorkspaceDocs(agent.id);

      const systemParts = [
        charterPrompt,
        personaPrompt,
        enrichedSkillPrompt,
        workspaceDocs,
      ].filter(Boolean);

      const systemPrompt = systemParts.join('\n\n');
      const messages: CoreMessage[] = [{ role: 'user', content: ctx.input }];

      // 9. Run LLM — always add write_memory tool
      const writeMemoryTool = buildWriteMemoryTool(agent.id);
      const allTools = { ...tools, write_memory: writeMemoryTool };
      const toolsArg = allTools;
      const result = await runLlm({
        model,
        messages,
        tools: toolsArg,
        systemPrompt,
        maxSteps: 8,  // prevent infinite tool-call loops
      });

      // 10. Persist result
      await this.prisma.agentRequest.update({
        where: { id: ctx.requestId },
        data: {
          status: 'COMPLETED',
          output: result.text,
          turns: messages as object[],
          toolCalls: result.toolCalls as object[],
          completedAt: new Date(),
        },
      });

      return { output: result.text };
    } catch (error) {
      if (error instanceof ApprovalRequiredError) {
        // Approval was requested — suspend cleanly (not a failure)
        await this.prisma.agentRequest.update({
          where: { id: ctx.requestId },
          data: { status: 'AWAITING_APPROVAL' },
        });
        return { output: `This action requires approval. Approval request created — check your configured notification channel or use the API to approve.` };
      }

      const msg = error instanceof Error ? error.message : String(error);
      await this.prisma.agentRequest.update({
        where: { id: ctx.requestId },
        data: { status: 'FAILED', errorMsg: msg, completedAt: new Date() },
      });
      throw error;
    }
  }
}




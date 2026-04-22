import type { CoreMessage, CoreTool } from 'ai';
import { PrismaClient, Prisma } from '@prisma/client';
import { tool } from 'ai';
import { z } from 'zod';
import { KnowledgeStore } from '@bclaw/knowledge-store';
import { SkillRegistryClient } from '@bclaw/skill-registry-client';

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

/** Build a read_memory tool so agents can explicitly query their stored memory. */
function buildReadMemoryTool(agentId: string): CoreTool {
  return tool({
    description: 'Read the current contents of this agent\'s long-term memory. Use this when asked to recall, summarise, or search what you remember.',
    parameters: z.object({
      query: z.string().optional().describe('Optional search term to filter relevant sections from memory. Leave empty to return all memory.'),
    }),
    execute: async ({ query }) => {
      const domain = `agent/${agentId}`;
      const entry = await knowledgeStore.read(domain, 'memory').catch(() => null);
      if (!entry?.content) return { memory: null, message: 'No memory stored yet.' };
      if (!query) return { memory: entry.content, updatedAt: entry.updatedAt };
      // Simple keyword filter: return lines/paragraphs containing the query term
      const lower = query.toLowerCase();
      const lines = entry.content.split('\n');
      const relevant = lines.filter((l) => l.toLowerCase().includes(lower));
      return {
        memory: relevant.length ? relevant.join('\n') : entry.content,
        filtered: relevant.length > 0,
        query,
        updatedAt: entry.updatedAt,
      };
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
   * Check the remote skill registry for a skill matching the given intent.
   * If found, install it locally (PUBLISHED) and return it so the orchestrator can use it
   * instead of triggering LLM-based skill generation.
   */
  private async tryRegistryFirstSkill(intent: string): Promise<{
    id: string; name: string; domain: string; description: string | null;
    capabilities: string[]; tools: unknown; systemPrompt: string | null;
  } | null> {
    const client = new SkillRegistryClient();
    if (!client.isConfigured) return null;

    let remoteSkills: Awaited<ReturnType<typeof client.list>> = [];
    try {
      remoteSkills = await client.list();
    } catch {
      return null; // registry unavailable — fail silently
    }

    if (remoteSkills.length === 0) return null;

    // Score remote skills against intent (same keyword algorithm as local findByIntent)
    const intentWords = intent.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const scored = remoteSkills.map(s => {
      let score = 0;
      const domainWords = s.domain.toLowerCase().split(/[.\-_]/);
      const nameText = s.name.toLowerCase();
      const descText = (s.description ?? '').toLowerCase();
      for (const word of intentWords) {
        if (domainWords.some(d => d.includes(word) || word.includes(d))) score += 3;
        if (nameText.includes(word)) score += 1.5;
        if (descText.includes(word)) score += 0.5;
      }
      return { skill: s, score };
    });

    const best = scored.sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 2) return null; // threshold: meaningful match required

    try {
      const manifest = await client.fetch(best.skill.domain, best.skill.version);
      if (!client.verify(manifest)) return null;

      // Install locally
      const installed = await this.prisma.skill.upsert({
        where: { domain_version: { domain: manifest.domain, version: manifest.version } },
        create: {
          name: manifest.name,
          domain: manifest.domain,
          version: manifest.version,
          description: manifest.description ?? null,
          capabilities: manifest.capabilities,
          tools: manifest.tools as Prisma.InputJsonValue,
          systemPrompt: manifest.systemPrompt ?? null,
          status: 'PUBLISHED',
        },
        update: {
          name: manifest.name,
          description: manifest.description ?? null,
          tools: manifest.tools as Prisma.InputJsonValue,
          systemPrompt: manifest.systemPrompt ?? null,
          capabilities: manifest.capabilities,
          status: 'PUBLISHED',
        },
        select: { id: true, name: true, domain: true, description: true, capabilities: true, tools: true, systemPrompt: true },
      });

      // Record in registry entries so it shows as "In Sync" locally
      await this.prisma.skillRegistryEntry.upsert({
        where: { domain_version: { domain: manifest.domain, version: manifest.version } },
        create: {
          domain: manifest.domain,
          version: manifest.version,
          name: manifest.name,
          description: manifest.description ?? null,
          manifest: manifest as Prisma.InputJsonValue,
          registryUrl: process.env['SKILL_REGISTRY_URL'] ?? '',
        },
        update: { manifest: manifest as Prisma.InputJsonValue },
      });

      console.info(`[orchestrator] Installed skill from registry: ${manifest.domain} v${manifest.version} (score: ${best.score})`);
      return installed;
    } catch {
      return null;
    }
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
      // then registry-first lookup before triggering LLM-based generation.
      // The default agent has access to ALL published skills (resolved by intent at runtime).
      const linkedSkills = agent.agentSkills.map((as) => as.skill);

      // skill is typed to the common subset needed downstream (tools, systemPrompt, id, domain)
      type SkillLike = { id: string; name: string; domain: string; description: string | null; capabilities: string[]; tools: unknown; systemPrompt: string | null };
      let skill: SkillLike | null = null;

      if (agent.isDefault) {
        // Default agent: always search all published skills by intent
        skill = await this.skillRegistry.findByIntent(ctx.input);
      } else if (linkedSkills.length > 0) {
        // Named agent: prefer skills linked to this agent, scored by intent
        if (linkedSkills.length === 1) {
          skill = linkedSkills[0] ?? null;
        } else {
          // Multiple linked skills — pick best match by intent
          const intentBest = await this.skillRegistry.findByIntent(ctx.input);
          skill = linkedSkills.find((s) => s.id === intentBest?.id) ?? linkedSkills[0] ?? null;
        }
      } else {
        skill = await this.skillRegistry.findByIntent(ctx.input);
      }

      // If no local match, try fetching from remote registry before falling back to generation
      if (!skill && linkedSkills.length === 0) {
        skill = await this.tryRegistryFirstSkill(ctx.input);
      }

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
      // We also handle skills that use xiq_http_call but have no requiredCredentialType set.
      const domainCredMap: Record<string, string> = {};

      // Known domain-prefix → credential keyword mappings (checked before token extraction)
      const DOMAIN_KEYWORD_MAP: Array<[string, string]> = [
        ['extremecloudiq', 'xiq'],
        ['networking.extreme-xco', 'xco'],
      ];

      const VALID_CRED_TYPES = new Set(['API_TOKEN', 'USERNAME_PASSWORD', 'SSH_KEY', 'BASIC_AUTH', 'OAUTH2_CLIENT', 'USER_PREFERENCE']);

      for (const s of linkedSkills) {
        // Detect requiredCredentialType from skill field OR from tool handlerTypes in the skill
        let credType = s.requiredCredentialType as string | null | undefined;
        if (!credType) {
          const tools = (s.tools as Array<Record<string, unknown>>) ?? [];
          const hasXiqTool = tools.some((t) => ['xiq_http_call', 'xiq_topology_report', 'xiq_radio_quality_report'].includes(t['handlerType'] as string));
          const hasXcoTool = tools.some((t) => t['handlerType'] === 'xco_http_call');
          if (hasXiqTool || hasXcoTool) credType = 'USERNAME_PASSWORD';
        }
        // Guard: skip if credType is not a valid Prisma CredentialType enum value
        if (!credType || !VALID_CRED_TYPES.has(credType)) {
          if (credType) console.warn(`[orchestrator] Skill ${s.id} has unrecognised requiredCredentialType "${credType}" — skipping credential resolution`);
          continue;
        }

        // Resolve keyword: check prefix map first, then token extraction
        let keyword: string | undefined;
        for (const [prefix, k] of DOMAIN_KEYWORD_MAP) {
          if (s.domain.startsWith(prefix)) { keyword = k; break; }
        }
        if (!keyword) {
          const stopWords = new Set(['networking', 'monitoring', 'cloud', 'extreme', 'extremecloudiq', 'operations', 'monitor']);
          const tokens = s.domain.split('.').flatMap((k: string) => k.split('-')).filter((k: string) => !stopWords.has(k));
          keyword = tokens[0];
        }

        // Try keyword match first; fall back to any SYSTEM credential of the required type
        let cred = await this.prisma.credential.findFirst({
          where: {
            scope: 'SYSTEM',
            credentialType: credType as 'API_TOKEN' | 'USERNAME_PASSWORD' | 'SSH_KEY' | 'OAUTH2_CLIENT' | 'USER_PREFERENCE',
            ...(keyword ? { name: { contains: keyword, mode: 'insensitive' as const } } : {}),
          },
          select: { id: true },
        });
        if (!cred && keyword) {
          // Fallback: any SYSTEM credential of the required type
          cred = await this.prisma.credential.findFirst({
            where: {
              scope: 'SYSTEM',
              credentialType: credType as 'API_TOKEN' | 'USERNAME_PASSWORD' | 'SSH_KEY' | 'OAUTH2_CLIENT' | 'USER_PREFERENCE',
            },
            select: { id: true },
          });
        }
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
        if (useThisEp && ep.baseUrl) {
          for (const tag of ep.tags) {
            hostMap[`${tag}-host`] = ep.baseUrl.replace(/\/$/, '');
          }
        }
      }
      // If no match, fallback to all endpoints (first one wins per tag)
      if (matchedEndpoint === undefined) {
        for (const ep of endpointRows) {
          if (!ep.baseUrl) continue;
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

        // Resolve {tag-host} in endpoint and config fields
        if (typeof resolved['endpoint'] === 'string') {
          resolved['endpoint'] = resolveHostPlaceholders(resolved['endpoint']);
        }
        const cfg = resolved['config'] as Record<string, unknown> | undefined;
        if (cfg) {
          const cfgUpdate: Record<string, unknown> = { ...cfg };
          if (typeof cfg['urlTemplate'] === 'string') cfgUpdate['urlTemplate'] = resolveHostPlaceholders(cfg['urlTemplate']);
          if (typeof cfg['authUrl'] === 'string') cfgUpdate['authUrl'] = resolveHostPlaceholders(cfg['authUrl']);
          resolved['config'] = cfgUpdate;
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
      let llmApiVersion: string | undefined;
      let llmProvider = agent.llmProvider as LlmProvider;
      let llmModel = agent.llmModel;

      try {
        const defaultConfig = await this.prisma.lLMConfig.findFirst({
          where: { isDefault: true },
          include: { credential: { select: { id: true } } },
        });
        if (defaultConfig) {
          llmProvider = defaultConfig.provider as LlmProvider;
          // Respect the agent's own model choice if set; only fall back to the default config model
          llmModel = agent.llmModel || defaultConfig.model;
          if (defaultConfig.credentialId) {
            const cred = await this.vault.resolve(defaultConfig.credentialId, []);
            llmApiKey = (cred as { apiKey?: string }).apiKey;
          }
          if (defaultConfig.baseUrl) {
            llmBaseUrl = defaultConfig.baseUrl;
          }
          if (defaultConfig.apiVersion) {
            llmApiVersion = defaultConfig.apiVersion;
          }
        }
      } catch {
        // Fall through to env-var based config
      }

      const model = buildLlmModel(llmProvider, llmModel, llmApiKey, llmBaseUrl, llmApiVersion);

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

      // Load domain intelligence: entity graphs + matching playbooks
      const domainIntelParts = await this.loadDomainIntelligence(linkedSkills, ctx.input);

      const systemParts = [
        charterPrompt,
        personaPrompt,
        enrichedSkillPrompt,
        domainIntelParts,
        workspaceDocs,
      ].filter(Boolean);


      const systemPrompt = systemParts.join('\n\n');
      const messages: CoreMessage[] = [{ role: 'user', content: ctx.input }];

      // 9. Run LLM — always add write_memory and read_memory tools
      const writeMemoryTool = buildWriteMemoryTool(agent.id);
      const readMemoryTool = buildReadMemoryTool(agent.id);
      const allTools = { ...tools, write_memory: writeMemoryTool, read_memory: readMemoryTool };
      const toolsArg = allTools;
      // Per-agent maxSteps override — read from Agent.llmConfig JSON
      const agentLlmConfig = agent.llmConfig as { maxSteps?: number } | null;
      const maxSteps = agentLlmConfig?.maxSteps ?? 8;

      const result = await runLlm({
        model,
        messages,
        tools: toolsArg,
        systemPrompt,
        maxSteps,
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

  /**
   * Loads domain knowledge (entity graphs + playbooks) for the active skill domains
   * and returns a formatted system prompt section. Playbooks are filtered to those
   * whose triggerPatterns have ≥2 words matching the user's query.
   */
  private async loadDomainIntelligence(
    skills: Array<{ domain: string }>,
    userInput: string,
  ): Promise<string> {
    if (skills.length === 0) return '';

    const topDomains = [...new Set(skills.map((s) => s.domain.split('.')[0]!))];
    const records = await this.prisma.domainKnowledge.findMany({
      where: { domain: { in: topDomains } },
    });

    if (records.length === 0) return '';

    const queryWords = new Set(
      userInput.toLowerCase().match(/\b\w{3,}\b/g) ?? [],
    );

    // Explicit @playbook-name mentions — bypass trigger scoring and inject directly.
    // Users can write "@vlan-ip-range-mapping" or "@client-health-overview" in their message.
    const atMentions = new Set(
      (userInput.match(/@([\w-]+)/g) ?? []).map((m) => m.slice(1).toLowerCase()),
    );

    const parts: string[] = [];

    for (const rec of records) {
      const entityGraph = rec.entityGraph as Record<string, unknown> | null;
      const playbooks = rec.playbooks as Array<Record<string, unknown>> | null;

      // Always inject entity graph if non-empty (tiny, high-value context)
      if (entityGraph && Object.keys(entityGraph).length > 0) {
        parts.push(`## Entity Relationships (${rec.domain})\n${JSON.stringify(entityGraph, null, 2)}`);
      }

      // Inject playbooks that are explicitly @mentioned OR where ≥2 trigger words appear
      if (Array.isArray(playbooks)) {
        for (const pb of playbooks) {
          const pbName = String(pb['name'] ?? '').toLowerCase();
          const pbSlug = pbName.replace(/\s+/g, '-');

          const explicitlyMentioned = atMentions.has(pbName) || atMentions.has(pbSlug);

          const triggers = (pb['triggerPatterns'] as string[] | undefined) ?? [];
          const matchCount = triggers.reduce((n, phrase) => {
            const phraseWords = phrase.toLowerCase().match(/\b\w{3,}\b/g) ?? [];
            return n + phraseWords.filter((w) => queryWords.has(w)).length;
          }, 0);

          if (explicitlyMentioned || matchCount >= 2) {
            parts.push(`## Analysis Playbook: ${pb['name']}\n${JSON.stringify(pb, null, 2)}`);
          }
        }
      }
    }

    return parts.join('\n\n');
  }
}




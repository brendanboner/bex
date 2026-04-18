import type { CoreMessage, CoreTool } from 'ai';
import { PrismaClient } from '@prisma/client';

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
        // Extract meaningful domain keyword to match credential by name
        const keywords = s.domain.split('.').filter((k: string) => !['networking', 'monitoring', 'cloud', 'extreme', 'extremecloudiq'].includes(k));
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
      // Used to substitute {tag-host} placeholders in skill tool URL templates.
      // e.g. Endpoint{tags:["xco"], baseUrl:"http://10.64.160.109"} → hostMap["xco-host"] = "http://10.64.160.109"
      const endpointRows = await this.prisma.endpoint.findMany({ select: { tags: true, baseUrl: true } });
      const hostMap: Record<string, string> = {};
      for (const ep of endpointRows) {
        for (const tag of ep.tags) {
          hostMap[`${tag}-host`] = ep.baseUrl.replace(/\/$/, '');
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
      const model = buildLlmModel(agent.llmProvider as LlmProvider, agent.llmModel);

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

      const systemParts = [
        charterPrompt,
        personaPrompt,
        enrichedSkillPrompt,
      ].filter(Boolean);

      const systemPrompt = systemParts.join('\n\n');
      const messages: CoreMessage[] = [{ role: 'user', content: ctx.input }];

      // 9. Run LLM
      const toolsArg = Object.keys(tools).length > 0 ? tools : undefined;
      const result = await runLlm({
        model,
        messages,
        ...(toolsArg !== undefined ? { tools: toolsArg } : {}),
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




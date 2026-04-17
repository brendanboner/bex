import type { CoreMessage } from 'ai';
import { PrismaClient } from '@prisma/client';

import type { ExecutionContext, LlmProvider } from '@bclaw/shared';
import { ErrorCodes } from '@bclaw/shared';
import { CredentialVaultService } from '@bclaw/credential-vault';
import { SkillRegistryService } from '@bclaw/skill-engine';
import { PermissionGatewayService } from '@bclaw/permission-gateway';

import { buildLlmModel, buildTools, runLlm } from './llm-runner.js';

const APPROVAL_POLL_INTERVAL_MS = 3_000;
const APPROVAL_POLL_MAX_ATTEMPTS = 600; // 30 minutes at 3s intervals

export class OrchestratorService {
  private readonly vault: CredentialVaultService;
  private readonly skillRegistry: SkillRegistryService;
  private readonly permGateway: PermissionGatewayService;

  constructor(private readonly prisma: PrismaClient) {
    this.vault = new CredentialVaultService(prisma);
    this.skillRegistry = new SkillRegistryService(prisma);
    this.permGateway = new PermissionGatewayService(prisma);
  }

  async execute(ctx: ExecutionContext): Promise<{ output: string }> {
    // 1. Load agent definition
    const agent = await this.prisma.agent.findUnique({
      where: { id: ctx.agentId },
      include: { agentSkills: { include: { skill: true } } },
    });

    if (!agent) {
      throw Object.assign(new Error('Agent not found'), { code: ErrorCodes.NOT_FOUND });
    }

    // 2. Update request status → RUNNING
    await this.prisma.agentRequest.update({
      where: { id: ctx.requestId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    try {
      // 3. Find matching skill by intent
      let skill = await this.skillRegistry.findByIntent(ctx.input);

      // 4. If no skill — request credential approval, then trigger discovery
      if (!skill) {
        await this.prisma.agentRequest.update({
          where: { id: ctx.requestId },
          data: { status: 'AWAITING_APPROVAL' },
        });

        const approvalChannel = (process.env['DEFAULT_APPROVAL_CHANNEL'] ?? 'telegram') as 'telegram' | 'teams';
        await this.permGateway.requestApproval(
          ctx.requestId,
          agent.name,
          ctx.userId,
          `Agent "${agent.name}" needs to discover a new skill for: "${ctx.input}"`,
          approvalChannel,
        );

        await this.waitForApproval(ctx.requestId);

        // Skill discovery — for now uses basic intent-only discovery
        const newSkill = await this.skillRegistry.createFromDiscovery({ intent: ctx.input });
        const created = await this.prisma.skill.findUnique({
          where: { id: newSkill.id },
          select: {
            id: true,
            name: true,
            domain: true,
            capabilities: true,
            tools: true,
            systemPrompt: true,
          },
        });
        skill = created;
      }

      // 5. Resolve credential for this agent (look for a SYSTEM credential first)
      const credentialRecord = await this.prisma.credential.findFirst({
        where: {
          scope: 'SYSTEM',
          allowedAgentPermissions: { hasSome: agent.permissions.length > 0 ? agent.permissions : ['*'] },
        },
        select: { id: true },
      });

      // 6. Build tools from skill definition
      const skillTools = (skill?.tools as Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        endpoint?: string;
      }>) ?? [];

      const tools = buildTools(
        skillTools,
        this.vault,
        agent.permissions,
        credentialRecord?.id,
      );

      // 7. Build LLM model
      const model = buildLlmModel(
        agent.llmProvider as LlmProvider,
        agent.llmModel,
      );

      // 8. Build system prompt
      const systemParts = [
        (agent.persona as { systemPromptOverride?: string })?.systemPromptOverride ?? '',
        skill?.systemPrompt ?? '',
        `You are ${(agent.persona as { name?: string })?.name ?? agent.name}.`,
        `Available capabilities: ${skill?.capabilities.join(', ') ?? 'general assistance'}.`,
      ].filter(Boolean);

      const systemPrompt = systemParts.join('\n\n');

      const messages: CoreMessage[] = [{ role: 'user', content: ctx.input }];

      // 9. Run LLM
      const result = await runLlm({ model, messages, tools, systemPrompt });

      // 10. Persist turns and result
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
      const msg = error instanceof Error ? error.message : String(error);
      await this.prisma.agentRequest.update({
        where: { id: ctx.requestId },
        data: { status: 'FAILED', errorMsg: msg, completedAt: new Date() },
      });
      throw error;
    }
  }

  private async waitForApproval(requestId: string): Promise<void> {
    for (let i = 0; i < APPROVAL_POLL_MAX_ATTEMPTS; i++) {
      const status = await this.permGateway.pollStatus(requestId);

      if (status === 'APPROVED') return;
      if (status === 'DENIED') {
        throw Object.assign(new Error('Request denied by approver'), {
          code: ErrorCodes.APPROVAL_DENIED,
        });
      }
      if (status === 'EXPIRED') {
        throw Object.assign(new Error('Approval request expired'), {
          code: ErrorCodes.APPROVAL_EXPIRED,
        });
      }

      await sleep(APPROVAL_POLL_INTERVAL_MS);
    }

    throw Object.assign(new Error('Approval polling timed out'), {
      code: ErrorCodes.APPROVAL_EXPIRED,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

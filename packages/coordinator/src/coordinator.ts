import type { CoreMessage } from 'ai';
import { generateText } from 'ai';
import type { PrismaClient } from '@prisma/client';

import { buildModel } from './model.js';
import { SessionManager } from './session-manager.js';
import { WorkflowPlanner } from './planner.js';
import type { WorkflowPlan } from './planner.js';
import {
  makeListAgentsTool,
  makeSpawnAgentTool,
  makeDelegateTaskTool,
  makeCheckTaskStatusTool,
  makeCheckConstraintTool,
  makePlanWorkflowTool,
  makeReadKnowledgeTool,
  makeWriteKnowledgeTool,
  makeListKnowledgeTopicsTool,
  makeCreateSkillTool,
  type EnqueueRequestFn,
} from './meta-tools.js';

export type { EnqueueRequestFn };

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoordinatorConfig = {
  llmProvider?: string;
  llmModel?: string;
  knowledgeDir?: string;
  enqueueRequest?: EnqueueRequestFn;
};

export type ChatResult = {
  sessionId: string;
  output: string;
  subTaskIds?: string[];
};

// ─── System prompt ────────────────────────────────────────────────────────────

const COORDINATOR_SYSTEM_PROMPT = `You are the Coordinator Gateway Node for an enterprise agentic framework.
Your primary role is intelligent routing — find the right specialist agent for every question, then synthesise results.

## Core routing rule (ALWAYS follow this)
For EVERY user message, your first action MUST be:
1. Call list_agents (optionally with a domain keyword extracted from the message) to discover available specialist agents.
2. If one or more agents match the topic, call delegate_task to send the question to the most relevant agent and relay its response to the user.
3. Only answer directly from your own reasoning if NO specialist agent exists for the topic.

This applies to SINGLE-domain questions too — if a user asks about XIQ, XCO, Kubernetes, networking, or any other domain and a specialist agent is active, route to that agent rather than answering yourself.

## Handling long-running tasks
delegate_task quick-polls for 10 s. If the agent is still working it returns { status: "PENDING", requestId }.
When this happens:
- Tell the user: "I've started that — [agent name] is working on it. Ask me for an update when you're ready."
- Remember the requestId so you can use check_task_status when the user follows up.
When the user asks for an update (e.g. "any update?", "is it done?", "what happened?"), call check_task_status with the requestId.

## Multi-domain questions
When a question spans multiple domains (e.g. comparing XIQ + XCO + K8s data):
1. Call check_domain_constraint to verify compatibility between the domains.
2. Call plan_workflow to decompose the goal into ordered sub-tasks.
3. Call list_agents to find the right agent for each sub-task.
4. Call delegate_task for each sub-task and collect results.
5. Synthesise all agent responses into a coherent final answer, citing which agent produced each piece of data.

## Capability gaps
When no agent can handle a sub-task:
- Call create_skill to trigger skill creation for that domain, then retry with spawn_agent.

## Knowledge base
Use read_knowledge, write_knowledge, and list_knowledge_topics to store and retrieve context that improves future reasoning. After each multi-step conversation, write a brief summary of what was discussed and resolved.

Always be concise, structured, and cite which agent produced each piece of data.`;

// ─── CoordinatorAgent ─────────────────────────────────────────────────────────

export class CoordinatorAgent {
  private readonly sessionManager: SessionManager;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: CoordinatorConfig = {},
  ) {
    this.sessionManager = new SessionManager(prisma);
  }

  async chat(
    sessionId: string | null,
    userId: string,
    message: string,
    channel: string,
  ): Promise<ChatResult> {
    // 1. Load or create session
    let session = sessionId !== null ? await this.sessionManager.get(sessionId) : null;
    if (session === null) {
      session = await this.sessionManager.create(userId, channel);
    }

    // 2. Append incoming user turn
    await this.sessionManager.appendTurn(session.id, {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    });

    // 3. Reconstruct message history for the LLM
    const historyMessages: CoreMessage[] = session.turns
      .filter((t) => t.role === 'user' || t.role === 'assistant')
      .map((t) => ({ role: t.role as 'user' | 'assistant', content: t.content }));

    const messages: CoreMessage[] = [...historyMessages, { role: 'user', content: message }];

    // 4. Build tools
    const knowledgeDir = this.config.knowledgeDir ?? process.env['KNOWLEDGE_DIR'] ?? './knowledge';

    const tools = {
      list_agents: makeListAgentsTool(this.prisma),
      spawn_agent: makeSpawnAgentTool(this.prisma, this.config.enqueueRequest),
      delegate_task: makeDelegateTaskTool(this.prisma, this.config.enqueueRequest),
      check_task_status: makeCheckTaskStatusTool(this.prisma),
      check_domain_constraint: makeCheckConstraintTool(this.prisma),
      plan_workflow: makePlanWorkflowTool(this.prisma),
      read_knowledge: makeReadKnowledgeTool(knowledgeDir),
      write_knowledge: makeWriteKnowledgeTool(knowledgeDir),
      list_knowledge_topics: makeListKnowledgeTopicsTool(knowledgeDir),
      create_skill: makeCreateSkillTool(this.prisma),
    };

    // 5. Run the LLM with multi-step tool calling
    const provider = this.config.llmProvider ?? process.env['LLM_PROVIDER'] ?? 'openai';
    const model = this.config.llmModel ?? process.env['LLM_MODEL'] ?? 'gpt-4o';
    const llmModel = buildModel(provider, model);

    const result = await generateText({
      model: llmModel,
      system: COORDINATOR_SYSTEM_PROMPT,
      messages,
      tools,
      maxSteps: 10,
    });

    // 6. Collect any sub-task request IDs from tool results
    const subTaskIds: string[] = result.steps
      .flatMap((step) => step.toolResults ?? [])
      .filter(
        (tr) =>
          (tr as { toolName?: string }).toolName === 'delegate_task' ||
          (tr as { toolName?: string }).toolName === 'spawn_agent',
      )
      .map((tr) => {
        const r = (tr as { result?: { requestId?: string } }).result;
        return r?.requestId;
      })
      .filter((id): id is string => typeof id === 'string');

    // 7. Persist assistant turn and complete session
    await this.sessionManager.appendTurn(session.id, {
      role: 'assistant',
      content: result.text,
      timestamp: new Date().toISOString(),
    });

    await this.sessionManager.complete(session.id, result.text);

    const chatResult: ChatResult = {
      sessionId: session.id,
      output: result.text,
      ...(subTaskIds.length > 0 ? { subTaskIds } : {}),
    };

    return chatResult;
  }

  async plan(userId: string, goal: string): Promise<WorkflowPlan> {
    const skills = await this.prisma.skill.findMany({
      where: { status: 'PUBLISHED' },
      select: { capabilities: true },
    });
    const availableCapabilities = skills.flatMap((s) => s.capabilities);

    const provider = this.config.llmProvider ?? process.env['LLM_PROVIDER'] ?? 'openai';
    const model = this.config.llmModel ?? process.env['LLM_MODEL'] ?? 'gpt-4o';
    const planner = new WorkflowPlanner(provider, model);

    return planner.plan(goal, availableCapabilities);
  }
}

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
  makeCreateDashboardTool,
  makeGetSystemStatusTool,
  makeGetCredentialStatusTool,
  makeGetAgentCapabilitiesTool,
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
  /** Request IDs for delegate_task calls that are still PENDING — callers should poll /requests/:id */
  pendingRequestIds?: string[];
};

// ─── System prompt ────────────────────────────────────────────────────────────

const COORDINATOR_SYSTEM_PROMPT = `You are the Coordinator Gateway Node for an enterprise agentic framework.
Your primary role is intelligent routing — find the right specialist agent for every question, then synthesise results.

## Core routing rule (ALWAYS follow this — NO EXCEPTIONS)
For EVERY user message that is not a platform management query (see below), you MUST:
1. Call list_agents with NO domain filter to discover ALL available agents and their current skills.
2. Read each agent's skill domains and capabilities to identify who can handle the request.
3. Call delegate_task to send the question to the most relevant agent and relay its response to the user.
4. ONLY answer directly from your own reasoning if list_agents returns zero agents, or none of the agents have any skills that relate to the query.

**NEVER skip step 1.** Even if you think you know the answer, you may not know which specialist agent is available.
**DO NOT** pass a domain filter to list_agents — always call it with no arguments so you see all agents.

## Agent domain reference (use as a hint — always verify by calling list_agents)
- XIQ / wireless / clients / access points / APs / SSIDs / VLANs / radio / signal → agent with skills under "extremecloudiq.*"
- XCO / fabric / BGP / spine / leaf / VTEP / alarms / orchestrator → agent with skills under "networking.extreme-xco.*"
- weather / forecast / temperature / rain / wind / climate → agent with skills under "weather.*"
- Any other domain — call list_agents and check capabilities; do NOT guess.

## Handling long-running tasks
delegate_task quick-polls for 30 s. If the agent is still working it returns { status: "PENDING", requestId }.
When this happens:
- Tell the user: "I've started that — [agent name] is working on it. The result will appear automatically when it's ready."
- Remember the requestId so you can use check_task_status if needed.
When the user asks for an update (e.g. "any update?", "is it done?"), call check_task_status with the requestId.

## Handling monitoring follow-up confirmations (CRITICAL)
When the user replies "yes", "proceed", "go ahead", "sure", "ok", "both", or similar short confirmations:
1. Identify from **session history or the current message context** which agent asked the question and what it was asking.
   - Session history may contain an assistant turn like "[Wireless_Network_Monitor]: ... Would you like me to proceed...?" — use that.
   - The current message may contain a "[Context: @agent asked: ...]" prefix — use that.
2. Check whether that agent has the skills to perform the follow-up task (call get_agent_capabilities).
3. If the agent has the required skills, delegate the follow-up task back to that agent with explicit context:
   e.g. "The user has confirmed: please proceed with [the specific follow-up task you asked about]."
4. If the required skill does NOT exist yet, call create_skill to build it, then spawn_agent to provision it,
   then delegate_task for the follow-up.
5. NEVER respond with "I don't know what you're saying yes to" or "session history does not show..." — always check both session history AND the current message context.

## Multi-domain questions
When a question spans multiple domains (e.g. comparing XIQ + XCO data):
1. Call check_domain_constraint to verify compatibility between the domains.
2. Call plan_workflow to decompose the goal into ordered sub-tasks.
3. Call list_agents (no filter) to find the right agent for each sub-task.
4. Call delegate_task for each sub-task and collect results.
5. Synthesise all agent responses into a coherent final answer, citing which agent produced each piece of data.

## Capability gaps
When no agent can handle a sub-task:
- Call create_skill to trigger skill creation for that domain, then retry with spawn_agent.

## Dashboard creation
When the user says "create a dashboard", "dashboard", "show as dashboard", or "create a dashboard for this" after seeing agent output:
- Call create_dashboard with a descriptive name and the agent's output as the prompt.
- Reply with the dashboard URL so the user can open it immediately.
- Format: "📊 Dashboard created: [name]\n🔗 <url>"

## Platform management queries (answer directly — do NOT route to an agent)
For questions about the BEX platform itself, use your system tools directly without calling list_agents first:
- "what capabilities does the X agent have?" / "what can X do?" → call get_agent_capabilities with the name keyword
- "has the X credential been configured?" / "is X set up?" → call get_credential_status with the name keyword
- "system status" / "platform status" / "what is running?" → call get_system_status
- "what agents are available?" / "list agents" → call list_agents (no domain filter)
- "what skills are published?" → call get_system_status

Never route platform management questions to domain agents (XIQ, XCO etc.) — they cannot answer them.

Always be concise, structured, and cite which agent produced each piece of data.`;

// ─── Channel-aware formatting prompt ─────────────────────────────────────────

function buildChannelFormattingPrompt(channel: string): string {
  switch (channel) {
    case 'telegram':
    case 'whatsapp':
      return `## CRITICAL: Response Format — ${channel}
You are responding in a CHAT MESSAGING APP. These rules OVERRIDE all previous formatting instructions:
- **NEVER output raw JSON, code blocks, or \`\`\`json … \`\`\` sections** in your final response.
- Write in plain, conversational prose only.
- Use short bullet points (•) for lists. Do NOT use markdown tables or ## headings.
- Keep responses concise — under 400 words unless the user explicitly asks for detail.
- For client/device lists: one line per item — "• <Name>: <key stat>". Max 10 items; note total if more.
- If an agent returns raw JSON or a data structure, translate it into plain English before responding.
- Never say "here is the JSON" or "the raw output is" — always interpret and summarise.`;

    case 'dashboard':
      return `## CRITICAL: Response Format — dashboard
You are responding in a web dashboard with full markdown rendering. These rules OVERRIDE all previous instructions:
- **NEVER output raw JSON or \`\`\`json … \`\`\` blocks** — always translate data into readable markdown.
- Use markdown: ## headings, **bold**, tables (| col | col |), and bullet lists.
- For client/device/AP lists: use a markdown table with relevant columns (Name, MAC, IP, SSID, Signal, etc.).
- For alarms/events: use a markdown table with Severity, Name, Device, Time columns.
- For summaries: lead with a one-line summary, then present data in a table or structured list.
- If an agent returns JSON or a data array, parse it and render it as a markdown table or list.
- You may include detail — the UI can scroll. Aim for completeness.`;

    default:
      return `## Response Format
- Use markdown tables for structured data (clients, devices, alarms).
- Lead with a one-line executive summary.
- Never output raw JSON — translate API data into readable markdown.`;
  }
}

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
      create_dashboard: makeCreateDashboardTool(this.prisma),
      get_system_status: makeGetSystemStatusTool(this.prisma),
      get_credential_status: makeGetCredentialStatusTool(this.prisma),
      get_agent_capabilities: makeGetAgentCapabilitiesTool(this.prisma),
    };

    // 5. Run the LLM with multi-step tool calling
    const provider = this.config.llmProvider ?? process.env['LLM_PROVIDER'] ?? 'openai';
    const model = this.config.llmModel ?? process.env['LLM_MODEL'] ?? 'gpt-4o';
    const llmModel = buildModel(provider, model);

    const result = await generateText({
      model: llmModel,
      system: COORDINATOR_SYSTEM_PROMPT + `\n\n## Current channel\nThis conversation is on channel: **${channel}**. Always pass \`channel: "${channel}"\` when calling delegate_task or spawn_agent so agents format their responses correctly.\n\n` + buildChannelFormattingPrompt(channel),
      messages,
      tools,
      maxSteps: 10,
    });

    // 6. Collect sub-task request IDs; split into completed vs still-pending
    const delegateResults: Array<{ requestId?: string; status?: string }> = result.steps
      .flatMap((step) => step.toolResults ?? [])
      .filter(
        (tr) =>
          (tr as { toolName?: string }).toolName === 'delegate_task' ||
          (tr as { toolName?: string }).toolName === 'spawn_agent',
      )
      .map((tr) => (tr as { result?: { requestId?: string; status?: string } }).result ?? {});

    const subTaskIds = delegateResults
      .map((r) => r.requestId)
      .filter((id): id is string => typeof id === 'string');

    const pendingRequestIds = delegateResults
      .filter((r) => r.status === 'PENDING')
      .map((r) => r.requestId)
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
      ...(pendingRequestIds.length > 0 ? { pendingRequestIds } : {}),
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

import type { PrismaClient, Agent, ScheduledJob } from '@prisma/client';
import { KnowledgeStore } from '@bclaw/knowledge-store';

export interface SpawnResult {
  agent: Agent;
  scheduledJob: ScheduledJob | null;
}

export type RespawnAction = 'created' | 'restored' | 'repaired';

export interface RespawnResult {
  agent: Agent;
  scheduledJob: ScheduledJob | null;
  action: RespawnAction;
  repairs: string[];
}

/** Infer agent posture from permission strings. Any write or exec permission → SUPERVISED. */
function inferPosture(permissions: string[]): 'SUPERVISED' | 'AUTONOMOUS' {
  const hasWriteOrExec = permissions.some((p) => /^(write|exec|delete|ssh):/.test(p));
  return hasWriteOrExec ? 'SUPERVISED' : 'AUTONOMOUS';
}

export class PersonaSpawner {
  private knowledgeStore: KnowledgeStore;

  constructor(private prisma: PrismaClient) {
    this.knowledgeStore = new KnowledgeStore(process.env['KNOWLEDGE_BASE_DIR'] ?? './knowledge');
  }

  async spawnAgent(
    personaId: string,
    ownerId: string,
    overrides?: { name?: string; llmProvider?: string; llmModel?: string },
  ): Promise<SpawnResult> {
    // 1. Load persona
    const persona = await this.prisma.persona.findUnique({ where: { id: personaId } });
    if (!persona) throw new Error(`Persona not found: ${personaId}`);

    // 1b. If an agent was already spawned from this persona, return it (no duplicates).
    const existingAgent = await this.prisma.agent.findFirst({
      where: { personaId: persona.id },
      orderBy: { createdAt: 'desc' },
    });
    if (existingAgent) {
      const existingJob = await this.prisma.scheduledJob.findFirst({
        where: { agentId: existingAgent.id },
        orderBy: { createdAt: 'desc' },
      });
      console.info(`[persona-spawner] Persona ${personaId} already has agent ${existingAgent.id} — reusing`);
      return { agent: existingAgent, scheduledJob: existingJob };
    }
    // 2. Find matching published skills.
    //    Two-pass strategy:
    //    Pass 1 — exact domain prefix: "weather" matches "weather.forecast", "weather.open-meteo"
    //    Pass 2 — keyword overlap: tokenise each requiredSkill and each skill's domain/name;
    //             if any token appears in the domain or name, it's a match.
    //    This handles LLM-generated names like "meteorology.forecasting" → matches "weather.*" via "forecast" token.
    let skills: { id: string }[] = [];
    if (persona.requiredSkills.length > 0) {
      // Pass 1: exact prefix match
      skills = await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Skill"
          WHERE status = 'PUBLISHED'
            AND EXISTS (
              SELECT 1 FROM unnest(${persona.requiredSkills}::text[]) AS prefix
              WHERE domain LIKE prefix || '%'
            )`;

      if (skills.length === 0) {
        // Pass 2: keyword-based fuzzy match — extract tokens from each requiredSkill
        const allPublished = await this.prisma.skill.findMany({
          where: { status: 'PUBLISHED' },
          select: { id: true, domain: true, name: true, capabilities: true },
        });
        const stopWords = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'with', 'by', 'from']);
        const skillTokens = persona.requiredSkills.flatMap((s: string) =>
          s.toLowerCase().split(/[\W_]+/).filter((t: string) => t.length > 2 && !stopWords.has(t)),
        );
        for (const pub of allPublished) {
          const domainTokens = pub.domain.toLowerCase().split(/[\W_]+/);
          const nameTokens = pub.name.toLowerCase().split(/\s+/);
          const capTokens = pub.capabilities.flatMap((c: string) => c.toLowerCase().split(/\s+/));
          const allTokens = new Set([...domainTokens, ...nameTokens, ...capTokens]);
          const hasMatch = skillTokens.some((st: string) =>
            [...allTokens].some(dt => dt.includes(st) || st.includes(dt)),
          );
          if (hasMatch && !skills.find(s => s.id === pub.id)) {
            skills.push({ id: pub.id });
          }
        }
      }
    }

    // 3. Create Agent — store the system prompt in the persona JSON blob
    const agent = await this.prisma.agent.create({
      data: {
        name: overrides?.name ?? persona.name,
        persona: { systemPrompt: persona.systemPrompt },
        llmProvider: overrides?.llmProvider ?? 'openai',
        llmModel: overrides?.llmModel ?? 'gpt-4o',
        permissions: persona.suggestedPermissions,
        personaId: persona.id,
        ownerId,
        status: 'ACTIVE',
      },
    });

    // 4. Create AgentSkill joins for matched skills
    if (skills.length > 0) {
      await this.prisma.agentSkill.createMany({
        data: skills.map((skill) => ({ agentId: agent.id, skillId: skill.id })),
        skipDuplicates: true,
      });
    }

    // 5. Auto-create AgentCharter from persona suggestedPermissions
    const posture = inferPosture(persona.suggestedPermissions);
    const charter = await this.prisma.agentCharter.create({
      data: {
        mandate: persona.goal,
        posture,
        bearing: 'CONCISE',
        verbosity: 'STANDARD',
        conductBoundaries: persona.suggestedPermissions
          .filter((p) => /^(delete|exec|ssh):/.test(p))
          .map((p) => p + ':*'),
        escalationTriggers: ['severity:CRITICAL', 'alarm_count > 10'],
      },
    });
    await this.prisma.agent.update({
      where: { id: agent.id },
      data: { charterId: charter.id },
    });

    // Copy workspace docs from persona to new agent (if they were created during generate)
    await this.copyWorkspaceDocs(persona.id, agent.id);

    // 6. If persona has a schedule, create ScheduledJob
    let scheduledJob: ScheduledJob | null = null;
    if (persona.schedule != null) {
      scheduledJob = await this.prisma.scheduledJob.create({
        data: {
          name: `${agent.name} — scheduled`,
          agentId: agent.id,
          cronExpr: persona.schedule,
          input: persona.goal,
          enabled: true,
        },
      });
    }

    return { agent, scheduledJob };
  }

  /**
   * Respawn: ensure a persona's agent and scheduled job exist and are healthy.
   *
   * - If no agent exists (was deleted) → full fresh spawn (action: 'created')
   * - If agent exists but INACTIVE → reactivate + repair any missing pieces (action: 'restored')
   * - If agent is ACTIVE but schedule/charter missing → repair those (action: 'repaired')
   */
  async respawnAgent(
    personaId: string,
    ownerId: string,
    overrides?: { name?: string; llmProvider?: string; llmModel?: string },
  ): Promise<RespawnResult> {
    const persona = await this.prisma.persona.findUnique({ where: { id: personaId } });
    if (!persona) throw new Error(`Persona not found: ${personaId}`);

    const repairs: string[] = [];

    // Find the most recently spawned agent for this persona
    const existing = await this.prisma.agent.findFirst({
      where: { personaId: persona.id },
      orderBy: { createdAt: 'desc' },
    });

    // ── Case 1: no agent at all → full fresh spawn ────────────────────────────
    if (!existing) {
      const { agent, scheduledJob } = await this.spawnAgent(personaId, ownerId, overrides);
      return { agent, scheduledJob, action: 'created', repairs: ['agent', 'charter', ...(scheduledJob ? ['schedule'] : [])] };
    }

    // ── Case 2 / 3: agent exists — repair what's missing ─────────────────────
    let agent = existing;
    const action: RespawnAction = agent.status !== 'ACTIVE' ? 'restored' : 'repaired';

    // Reactivate if INACTIVE
    if (agent.status !== 'ACTIVE') {
      agent = await this.prisma.agent.update({
        where: { id: agent.id },
        data: { status: 'ACTIVE' },
      });
      repairs.push('status → ACTIVE');
    }

    // Recreate charter if missing
    if (!agent.charterId) {
      const posture = inferPosture(persona.suggestedPermissions);
      const charter = await this.prisma.agentCharter.create({
        data: {
          mandate: persona.goal,
          posture,
          bearing: 'CONCISE',
          verbosity: 'STANDARD',
          conductBoundaries: persona.suggestedPermissions
            .filter((p) => /^(delete|exec|ssh):/.test(p))
            .map((p) => p + ':*'),
          escalationTriggers: ['severity:CRITICAL', 'alarm_count > 10'],
        },
      });
      agent = await this.prisma.agent.update({
        where: { id: agent.id },
        data: { charterId: charter.id },
      });
      repairs.push('charter');
    }

    // Find or recreate scheduled job
    let scheduledJob: ScheduledJob | null = null;
    if (persona.schedule != null) {
      scheduledJob = await this.prisma.scheduledJob.findFirst({
        where: { agentId: agent.id },
        orderBy: { createdAt: 'desc' },
      });

      if (!scheduledJob) {
        scheduledJob = await this.prisma.scheduledJob.create({
          data: {
            name: `${agent.name} — scheduled`,
            agentId: agent.id,
            cronExpr: persona.schedule,
            input: persona.goal,
            enabled: true,
          },
        });
        repairs.push('schedule');
      } else if (!scheduledJob.enabled) {
        // Re-enable if it was disabled
        scheduledJob = await this.prisma.scheduledJob.update({
          where: { id: scheduledJob.id },
          data: { enabled: true },
        });
        repairs.push('schedule re-enabled');
      }
    }

    return { agent, scheduledJob, action, repairs };
  }

  /** Copy workspace docs (instructions/context/memory) from persona domain to agent domain. */
  private async copyWorkspaceDocs(personaId: string, agentId: string): Promise<void> {
    const topics = ['instructions', 'context', 'memory'];
    await Promise.all(
      topics.map(async (topic) => {
        const entry = await this.knowledgeStore.read(`agent/${personaId}`, topic).catch(() => null);
        if (entry?.content) {
          await this.knowledgeStore.write(`agent/${agentId}`, topic, entry.content);
        }
      }),
    );
  }
}

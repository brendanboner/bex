import type { PrismaClient, Agent, ScheduledJob } from '@prisma/client';

export interface SpawnResult {
  agent: Agent;
  scheduledJob: ScheduledJob | null;
}

/** Infer agent posture from permission strings. Any write or exec permission → SUPERVISED. */
function inferPosture(permissions: string[]): 'SUPERVISED' | 'AUTONOMOUS' {
  const hasWriteOrExec = permissions.some((p) => /^(write|exec|delete|ssh):/.test(p));
  return hasWriteOrExec ? 'SUPERVISED' : 'AUTONOMOUS';
}

export class PersonaSpawner {
  constructor(private prisma: PrismaClient) {}

  async spawnAgent(
    personaId: string,
    ownerId: string,
    overrides?: { name?: string; llmProvider?: string; llmModel?: string },
  ): Promise<SpawnResult> {
    // 1. Load persona
    const persona = await this.prisma.persona.findUnique({ where: { id: personaId } });
    if (!persona) throw new Error(`Persona not found: ${personaId}`);

    // 2. Find matching published skills by domain prefix.
    //    A persona lists domain prefixes like "extremecloudiq" and we match any skill
    //    whose domain starts with one of those prefixes (e.g. extremecloudiq.devices).
    const skills =
      persona.requiredSkills.length > 0
        ? await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Skill"
            WHERE status = 'PUBLISHED'
              AND EXISTS (
                SELECT 1 FROM unnest(${persona.requiredSkills}::text[]) AS prefix
                WHERE domain LIKE prefix || '%'
              )`
        : [];

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
}

import type { PrismaClient, Agent } from '@prisma/client';

export class PersonaSpawner {
  constructor(private prisma: PrismaClient) {}

  async spawnAgent(
    personaId: string,
    ownerId: string,
    overrides?: { name?: string; llmProvider?: string; llmModel?: string },
  ): Promise<Agent> {
    // 1. Load persona
    const persona = await this.prisma.persona.findUnique({ where: { id: personaId } });
    if (!persona) throw new Error(`Persona not found: ${personaId}`);

    // 2. Find matching published skills for each requiredSkill domain
    const skills =
      persona.requiredSkills.length > 0
        ? await this.prisma.skill.findMany({
            where: {
              status: 'PUBLISHED',
              domain: { in: persona.requiredSkills },
            },
            select: { id: true },
          })
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
    await Promise.all(
      skills.map((skill) =>
        this.prisma.agentSkill.create({
          data: { agentId: agent.id, skillId: skill.id },
        }),
      ),
    );

    // 5. If persona has a schedule, create ScheduledJob with the persona goal as input prompt.
    if (persona.schedule != null) {
      await this.prisma.scheduledJob.create({
        data: {
          name: `${agent.name} — scheduled`,
          agentId: agent.id,
          cronExpr: persona.schedule,
          input: persona.goal,
          enabled: true,
        },
      });
    }

    return agent;
  }
}

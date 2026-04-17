import type { PrismaClient } from '@prisma/client';

export interface AgentCapabilities {
  agentId: string;
  agentName: string;
  skillDomains: string[];
  permissions: string[];
}

export class CapabilityRouter {
  constructor(private prisma: PrismaClient) {}

  async getAgentCapabilities(): Promise<AgentCapabilities[]> {
    const agents = await this.prisma.agent.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        permissions: true,
        agentSkills: {
          select: {
            skill: { select: { domain: true } },
          },
        },
      },
    });

    return agents.map((agent) => ({
      agentId: agent.id,
      agentName: agent.name,
      skillDomains: agent.agentSkills.map((as) => as.skill.domain),
      permissions: agent.permissions,
    }));
  }

  async findAgents(requiredCapabilities: string[]): Promise<AgentCapabilities[]> {
    const all = await this.getAgentCapabilities();
    return all.filter((agent) => {
      const allCaps = [...agent.skillDomains, ...agent.permissions];
      return requiredCapabilities.every((cap) => allCaps.includes(cap));
    });
  }

  async findBestAgent(requiredCapabilities: string[]): Promise<AgentCapabilities | null> {
    const matching = await this.findAgents(requiredCapabilities);
    if (matching.length === 0) return null;

    // Prefer agents with the most overall capabilities (broadest coverage)
    const scored = matching.map((agent) => ({
      agent,
      score: agent.skillDomains.length + agent.permissions.length,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.agent ?? null;
  }
}

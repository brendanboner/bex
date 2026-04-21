import { PrismaClient, Prisma } from '@prisma/client';

import type { CreateSkillInput, LlmProvider, SkillDiscoveryRequest } from '@bclaw/shared';
import { ErrorCodes } from '@bclaw/shared';

import { SkillDiscoveryService } from './discovery.js';

export class SkillRegistryService {
  private readonly discovery: SkillDiscoveryService;

  constructor(
    private readonly prisma: PrismaClient,
    llmProvider: LlmProvider = 'openai',
  ) {
    this.discovery = new SkillDiscoveryService(llmProvider);
  }

  /**
   * Returns the published skill best matching the given capabilities intent.
   * Returns null if no matching skill exists (triggering discovery).
   */
  async findByIntent(intent: string): Promise<{
    id: string;
    name: string;
    domain: string;
    description: string | null;
    capabilities: string[];
    tools: unknown;
    systemPrompt: string | null;
  } | null> {
    const skills = await this.prisma.skill.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, name: true, domain: true, description: true, capabilities: true, tools: true, systemPrompt: true, requiredCredentialType: true },
    });

    if (skills.length === 0) return null;

    const intentWords = intent.toLowerCase().split(/\W+/).filter((w) => w.length > 2);

    const scored = skills.map((skill) => {
      let score = 0;
      const domainWords = skill.domain.toLowerCase().split(/[.\-_]/);
      const capText = skill.capabilities.join(' ').toLowerCase();
      const nameText = skill.name.toLowerCase();
      const descText = (skill.description ?? '').toLowerCase();

      for (const word of intentWords) {
        // Domain match — highest weight (indicates direct domain targeting)
        if (domainWords.some((d) => d.includes(word) || word.includes(d))) score += 3;
        // Capability match — strong signal
        if (capText.includes(word)) score += 2;
        // Name match — medium signal
        if (nameText.includes(word)) score += 1.5;
        // Description match — weaker signal
        if (descText.includes(word)) score += 0.5;
      }

      // Prefer skills that don't require credentials — no config friction for the user
      if (!skill.requiredCredentialType) score += 0.5;

      return { skill, score };
    });

    const best = scored.sort((a, b) => b.score - a.score)[0];
    // Return null if no meaningful match (score threshold prevents random matches)
    if (!best || best.score < 1) return null;
    // Strip internal scoring field from returned object
    const { requiredCredentialType: _cred, ...skillData } = best.skill;
    return skillData;
  }

  async findByDomain(domain: string): Promise<{
    id: string;
    name: string;
    domain: string;
    description: string | null;
    capabilities: string[];
    tools: unknown;
    systemPrompt: string | null;
  } | null> {
    return this.prisma.skill.findFirst({
      where: { domain, status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createFromDiscovery(request: SkillDiscoveryRequest): Promise<{ id: string }> {
    const result = await this.discovery.discover(request);

    return this.register(result.skill);
  }

  async register(input: CreateSkillInput): Promise<{ id: string }> {
    const existing = await this.prisma.skill.findUnique({
      where: { domain_version: { domain: input.domain, version: input.version } },
    });

    if (existing) {
      throw Object.assign(
        new Error(`Skill ${input.domain}@${input.version} already exists`),
        { code: ErrorCodes.CONFLICT },
      );
    }

    const skill = await this.prisma.skill.create({
      data: {
        name: input.name,
        domain: input.domain,
        description: input.description ?? null,
        version: input.version,
        status: 'DRAFT',
        capabilities: input.capabilities,
        tools: input.tools as Prisma.InputJsonValue,
        systemPrompt: input.systemPrompt ?? null,
        requiredCredentialType: input.requiredCredentialType ?? null,
      },
      select: { id: true },
    });

    return skill;
  }

  async publish(skillId: string): Promise<void> {
    const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) {
      throw Object.assign(new Error('Skill not found'), { code: ErrorCodes.NOT_FOUND });
    }
    await this.prisma.skill.update({
      where: { id: skillId },
      data: { status: 'PUBLISHED' },
    });
  }

  async addKnowledgeSource(
    skillId: string,
    source: {
      type: 'OPENAPI_JSON' | 'PDF' | 'MARKDOWN' | 'URL';
      label: string;
      url?: string;
      rawContent?: Buffer;
    },
  ): Promise<{ id: string }> {
    const result = await this.prisma.knowledgeSource.create({
      data: {
        skillId,
        type: source.type,
        label: source.label,
        url: source.url ?? null,
        rawContent: source.rawContent ?? null,
        parsedAt: new Date(),
      },
      select: { id: true },
    });
    return result;
  }
}

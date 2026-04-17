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
    capabilities: string[];
    tools: unknown;
    systemPrompt: string | null;
  } | null> {
    // Simple capability keyword search — replace with vector similarity in v2
    const skills = await this.prisma.skill.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true,
        name: true,
        domain: true,
        capabilities: true,
        tools: true,
        systemPrompt: true,
      },
    });

    type SkillRow = (typeof skills)[number];
    type ScoredSkill = { skill: SkillRow; score: number };
    const intentWords = intent.toLowerCase().split(/\s+/);
    const scored: ScoredSkill[] = skills.map((skill: SkillRow) => {
      const capText = skill.capabilities.join(' ').toLowerCase();
      const matches = intentWords.filter((w) => capText.includes(w)).length;
      return { skill, score: matches };
    });

    scored.sort((a: ScoredSkill, b: ScoredSkill) => b.score - a.score);
    const best = scored[0];
    return best && best.score > 0 ? best.skill : null;
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

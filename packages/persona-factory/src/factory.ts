import { generateObject } from 'ai';
import { z } from 'zod';
import type { PrismaClient, Persona } from '@prisma/client';
import { buildModel } from '@bclaw/skill-engine';
import type { LlmProvider } from '@bclaw/shared';

export interface GeneratePersonaOptions {
  goal: string;
  domain?: string;
  existingSkills?: string[];
  schedule?: string; // explicit cron override — skips LLM inference
}

export interface GeneratedPersona {
  name: string;
  goal: string;
  domain?: string;
  systemPrompt: string;
  requiredSkills: string[];
  suggestedPermissions: string[];
  schedule?: string;
  tags: string[];
}

const PersonaSchema = z.object({
  name: z.string().describe('Short descriptive agent name'),
  systemPrompt: z.string().describe('Full system prompt for the agent'),
  requiredSkills: z.array(z.string()).describe('Skill domain identifiers needed'),
  suggestedPermissions: z
    .array(z.string())
    .describe('Permission strings needed (e.g. read:network, ssh:exec)'),
  schedule: z
    .string()
    .optional()
    .describe('Cron expression if this agent should run on a schedule'),
  tags: z.array(z.string()).describe('Discovery tags'),
  rationale: z.string().describe('Brief explanation of design choices'),
});

export class PersonaFactory {
  constructor(
    private prisma: PrismaClient,
    private llmProvider: string = 'openai',
    private llmModel: string = 'gpt-4o',
  ) {}

  async generate(options: GeneratePersonaOptions): Promise<GeneratedPersona> {
    const model = buildModel(this.llmProvider as LlmProvider);

    const domainHint = options.domain ? `\nDomain hint: ${options.domain}` : '';
    const skillsHint =
      options.existingSkills && options.existingSkills.length > 0
        ? `\nAvailable skill domains: ${options.existingSkills.join(', ')}`
        : '';

    const { object } = await generateObject({
      model,
      schema: PersonaSchema,
      system:
        'You are an expert agentic system designer. Given a natural-language goal, ' +
        'design a complete agent persona. Be specific about required skills (use dot-separated ' +
        'domain identifiers like "networking.extreme-xco"), permissions, and system prompts. ' +
        'Only set a cron schedule if the goal implies periodic/automated execution.',
      prompt: `Goal: ${options.goal}${domainHint}${skillsHint}`,
    });

    const created = await this.prisma.persona.create({
      data: {
        name: object.name,
        goal: options.goal,
        ...(options.domain !== undefined ? { domain: options.domain } : {}),
        systemPrompt: object.systemPrompt,
        requiredSkills: object.requiredSkills,
        suggestedPermissions: object.suggestedPermissions,
        // Explicit schedule from user takes precedence over LLM-inferred
        schedule: options.schedule ?? object.schedule ?? null,
        tags: object.tags,
      },
    });

    return {
      name: created.name,
      goal: created.goal,
      ...(created.domain != null ? { domain: created.domain } : {}),
      systemPrompt: created.systemPrompt,
      requiredSkills: created.requiredSkills,
      suggestedPermissions: created.suggestedPermissions,
      ...(created.schedule != null ? { schedule: created.schedule } : {}),
      tags: created.tags,
    };
  }

  async list(domain?: string): Promise<Persona[]> {
    return this.prisma.persona.findMany({
      ...(domain !== undefined ? { where: { domain } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string): Promise<Persona | null> {
    return this.prisma.persona.findUnique({ where: { id } });
  }
}

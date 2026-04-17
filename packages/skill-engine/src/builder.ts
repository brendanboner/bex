import { generateObject } from 'ai';
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';

import type { LlmProvider, SkillDiscoveryResult } from '@bclaw/shared';
import { CreateSkillSchema } from '@bclaw/shared';

import { parseMarkdown, parseOpenApi, parsePdf } from './knowledge-parser.js';
import type { ParsedKnowledge } from './knowledge-parser.js';
import { buildModel } from './model.js';

const BUILDER_SYSTEM_PROMPT = `You are a skill architect for an enterprise agentic platform.
Given a description of a capability and relevant knowledge sources (API docs, PDFs, etc.),
generate a comprehensive skill definition.

A skill defines:
- name: short human-readable name
- domain: reverse-DNS style identifier (e.g. networking.extreme-xco)
- description: what this skill enables
- version: start at 1.0.0
- capabilities: array of short capability strings (e.g. "list-devices", "create-vlan", "get-fabric-topology")
- tools: array of LLM tool definitions the agent can call
- systemPrompt: a system prompt fragment injected when this skill is active

Generate a comprehensive skill that covers ALL operations visible in the API documentation.
Include both read (GET) and write (POST/PUT/DELETE) operations.
For each tool, generate complete JSON Schema parameters with descriptions.
Tool names must be snake_case (e.g. get_devices, create_vlan, get_fabric_topology, ssh_exec).
Every parameter must include a "type" and "description" field.
Do not omit any endpoints present in the documentation.`;

export type BuildSkillSource = {
  type: 'openapi_url' | 'pdf_url' | 'markdown_url' | 'raw_markdown';
  url?: string;
  content?: string;
  label: string;
};

export type BuildSkillRequest = {
  domain: string;
  intent: string;
  sources: BuildSkillSource[];
  llmProvider?: LlmProvider;
};

export type BuildSkillResult = {
  skillId: string;
  skill: SkillDiscoveryResult['skill'];
};

/** Maps a builder source type to the Prisma KnowledgeSourceType enum value. */
function toKnowledgeSourceType(
  type: BuildSkillSource['type'],
): 'OPENAPI_JSON' | 'PDF' | 'MARKDOWN' | 'URL' {
  switch (type) {
    case 'openapi_url':
      return 'OPENAPI_JSON';
    case 'pdf_url':
      return 'PDF';
    case 'markdown_url':
    case 'raw_markdown':
      return 'MARKDOWN';
  }
}

export class SkillBuilderService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly llmProvider: LlmProvider = 'openai',
  ) {}

  async build(request: BuildSkillRequest): Promise<BuildSkillResult> {
    const llmProvider = request.llmProvider ?? this.llmProvider;

    type ParsedWithSource = ParsedKnowledge & { source: BuildSkillSource };
    const parsed: ParsedWithSource[] = [];

    for (const source of request.sources) {
      let knowledge: ParsedKnowledge;

      switch (source.type) {
        case 'openapi_url': {
          if (!source.url) throw new Error(`Source "${source.label}" requires a url`);
          const res = await fetch(source.url);
          if (!res.ok)
            throw new Error(`Failed to fetch OpenAPI from ${source.url}: ${res.statusText}`);
          const json = (await res.json()) as Record<string, unknown>;
          knowledge = parseOpenApi(json);
          break;
        }
        case 'pdf_url': {
          if (!source.url) throw new Error(`Source "${source.label}" requires a url`);
          const res = await fetch(source.url);
          if (!res.ok)
            throw new Error(`Failed to fetch PDF from ${source.url}: ${res.statusText}`);
          const buffer = Buffer.from(await res.arrayBuffer());
          knowledge = await parsePdf(buffer);
          break;
        }
        case 'markdown_url': {
          if (!source.url) throw new Error(`Source "${source.label}" requires a url`);
          const res = await fetch(source.url);
          if (!res.ok)
            throw new Error(`Failed to fetch Markdown from ${source.url}: ${res.statusText}`);
          const text = await res.text();
          knowledge = parseMarkdown(text);
          break;
        }
        case 'raw_markdown': {
          if (!source.content) throw new Error(`Source "${source.label}" requires content`);
          knowledge = parseMarkdown(source.content);
          break;
        }
      }

      parsed.push({ ...knowledge, source });
    }

    const knowledgeContext = parsed
      .map((p, i) => `--- Source ${i + 1}: ${p.source.label} (${p.type}) ---\n${p.content}`)
      .join('\n\n');

    const userPrompt = [`Intent: ${request.intent}`, `Domain: ${request.domain}`, '', knowledgeContext].join('\n');

    const model = buildModel(llmProvider);

    const { object } = await generateObject({
      model,
      system: BUILDER_SYSTEM_PROMPT,
      prompt: userPrompt,
      schema: z.object({
        skill: CreateSkillSchema,
        confidence: z.number().min(0).max(1),
      }),
    });

    const skill = await this.prisma.skill.create({
      data: {
        name: object.skill.name,
        domain: object.skill.domain,
        description: object.skill.description ?? null,
        version: object.skill.version,
        status: 'DRAFT',
        capabilities: object.skill.capabilities,
        tools: object.skill.tools as Prisma.InputJsonValue,
        systemPrompt: object.skill.systemPrompt ?? null,
      },
      select: { id: true },
    });

    for (const p of parsed) {
      await this.prisma.knowledgeSource.create({
        data: {
          skillId: skill.id,
          type: toKnowledgeSourceType(p.source.type),
          label: p.source.label,
          url: p.source.url ?? null,
          parsedAt: new Date(),
        },
      });
    }

    return { skillId: skill.id, skill: object.skill };
  }
}

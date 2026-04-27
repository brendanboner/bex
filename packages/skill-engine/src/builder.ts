import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';

import type { LlmProvider, SkillDiscoveryResult } from '@bex/shared';
import { CreateSkillSchema } from '@bex/shared';

import { parseMarkdown, parseOpenApi, parsePdf, discoverLinkedDocs } from './knowledge-parser.js';
import type { ParsedKnowledge, DocRef } from './knowledge-parser.js';
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
Do not omit any endpoints present in the documentation.

IMPORTANT — parameter accuracy:
When the knowledge source includes real parameter schemas (marked with "param ... [required]" or "body fields:"),
you MUST use those EXACT field names and types in your tool definitions. Do not invent or rename parameters.
When the source includes "response fields:", document exactly how to extract values from that response
in the tool description — e.g. "returns results[0].latitude".`;

const CHAIN_DOC_SYSTEM_PROMPT = `You are a tool-chain documentation expert.
Given a list of tools in a skill, write a concise system prompt section that tells
an LLM agent exactly how to chain tool calls together correctly.

For each tool that depends on the output of another:
- Name the source tool and the exact field path to extract (e.g. results[0].latitude)
- Name the destination tool and the exact parameter name to use
- Be concrete and specific — the agent will follow these instructions literally

Format as a short numbered list. Do not include general advice, only concrete data-flow instructions.
Start with: "## Tool Chain Instructions"`;

const PLAYBOOK_SYSTEM_PROMPT = `You are a workflow analyst for an enterprise agentic platform.
Given a list of tools in a domain skill, generate 1-3 analysis playbooks that an agent could perform.

A playbook is a named multi-step workflow that combines multiple tool calls to answer a complex query.
Good playbooks answer questions that require: entity resolution, cross-tool joins, data aggregation, or inference.

For each playbook output EXACTLY this JSON structure:
{
  "name": "kebab-case-name",
  "description": "one sentence: what question does this answer",
  "triggerPatterns": ["2-4 short keyword phrases that would trigger this", ...],
  "steps": [
    { "step": 1, "tool": "tool_name", "purpose": "what we're getting", "extractField": "field.path to extract for next step" },
    { "step": 2, "tool": "tool_name", "params": { "param": "{step1.extractedField}" }, "purpose": "what we're getting", "extractField": "..." },
    ...
    { "step": N, "compute": "describe any inference/calculation needed (e.g. group by first 3 IP octets → /24)", "output": "describe the final table/result format" }
  ]
}

Only generate playbooks where 2+ tools must be chained. Skip single-tool queries.
Return an array of 1-3 playbook objects. Return valid JSON only, no markdown fences.`;

/** Generate playbooks from the built tool definitions */
async function generatePlaybooks(
  domain: string,
  tools: unknown[],
  capabilities: string[],
  provider: LlmProvider,
): Promise<Array<Record<string, unknown>>> {
  try {
    const toolSummary = (tools as Array<Record<string, unknown>>)
      .slice(0, 30) // don't overwhelm context
      .map((t) => `- ${t['name']}: ${t['description'] ?? ''}`)
      .join('\n');

    const model = buildModel(provider);
    const { text } = await generateText({
      model,
      system: PLAYBOOK_SYSTEM_PROMPT,
      prompt: `Domain: ${domain}\nCapabilities: ${capabilities.slice(0, 20).join(', ')}\n\nTools:\n${toolSummary}\n\nGenerate playbooks as a JSON array.`,
      maxTokens: 1200,
    });

    const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/** Merge incoming doc refs into existing, deduplicating by URL */
function mergeDocRefs(existing: DocRef[], incoming: DocRef[]): DocRef[] {
  const map = new Map(existing.map((d) => [d.url, d]));
  for (const ref of incoming) {
    if (!map.has(ref.url)) map.set(ref.url, ref);
  }
  return [...map.values()];
}

/** Merge incoming playbooks into existing, deduplicating by name */
function mergePlaybooks(
  existing: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const map = new Map(existing.map((p) => [p['name'], p]));
  for (const p of incoming) {
    map.set(p['name'], p); // incoming wins on conflict
  }
  return [...map.values()];
}

/** Generate explicit chain documentation from the built tool definitions */
async function generateChainDocs(
  tools: unknown[],
  provider: LlmProvider,
): Promise<string> {
  try {
    const toolSummary = (tools as Array<Record<string, unknown>>)
      .map((t) => {
        const params = t['parameters'] as Record<string, unknown> | undefined;
        const props = (params?.['properties'] as Record<string, unknown>) ?? {};
        const required = (params?.['required'] as string[]) ?? [];
        const paramList = Object.entries(props)
          .map(([k, v]) => {
            const pv = v as Record<string, unknown>;
            const req = required.includes(k) ? '[required]' : '[optional]';
            return `${k}: ${pv['type'] ?? 'any'} ${req} — ${pv['description'] ?? ''}`;
          })
          .join(', ');
        return `Tool: ${t['name']}\nDescription: ${t['description']}\nEndpoint: ${t['endpoint'] ?? 'n/a'}\nParams: ${paramList}`;
      })
      .join('\n\n');

    const model = buildModel(provider);
    const { text } = await generateText({
      model,
      system: CHAIN_DOC_SYSTEM_PROMPT,
      prompt: `Generate chain documentation for these tools:\n\n${toolSummary}`,
      maxTokens: 800,
    });
    return text.trim();
  } catch {
    return '';
  }
}

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

    // Generate explicit chain documentation so agents know exactly how to pipe
    // one tool's output fields into the next tool's required inputs.
    const chainDocs = await generateChainDocs(
      object.skill.tools as unknown[],
      llmProvider,
    );
    const systemPrompt = [object.skill.systemPrompt, chainDocs]
      .filter(Boolean)
      .join('\n\n') || null;

    const skill = await (async () => {
      // If a skill with this domain+version already exists, bump version
      let version = object.skill.version;
      let existing = await this.prisma.skill.findFirst({ where: { domain: object.skill.domain, version }, select: { id: true } });
      if (existing) {
        const parts = version.split('.').map(Number);
        parts[2] = (parts[2] ?? 0) + 1;
        version = parts.join('.');
      }

      return this.prisma.skill.create({
        data: {
          name: object.skill.name,
          domain: object.skill.domain,
          description: object.skill.description ?? null,
          version,
          status: 'DRAFT',
          capabilities: object.skill.capabilities,
          tools: object.skill.tools as Prisma.InputJsonValue,
          systemPrompt,
        },
        select: { id: true },
      });
    })();

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

    // ── Domain Intelligence Layer: discover linked docs + generate playbooks ──
    void this.updateDomainKnowledge(
      request.domain,
      request.sources,
      object.skill.tools as unknown[],
      object.skill.capabilities,
      llmProvider,
    ).catch(() => { /* non-fatal — skill was saved */ });

    return { skillId: skill.id, skill: object.skill };
  }

  /**
   * Discovers linked documentation from source URLs and generates analysis
   * playbooks for this domain. Runs after skill creation (fire-and-forget safe).
   */
  private async updateDomainKnowledge(
    domain: string,
    sources: BuildSkillSource[],
    tools: unknown[],
    capabilities: string[],
    provider: LlmProvider,
  ): Promise<void> {
    const topDomain = domain.split('.')[0]!;

    // 1. Discover linked docs from all URL-based sources
    const allRefs: DocRef[] = [];
    for (const source of sources) {
      if (source.url) {
        const refs = await discoverLinkedDocs(source.url);
        allRefs.push(...refs);
      }
    }

    // 2. Generate analysis playbooks (3rd LLM pass)
    const newPlaybooks = await generatePlaybooks(domain, tools, capabilities, provider);

    // 3. Upsert into DomainKnowledge (merge with existing)
    const existing = await this.prisma.domainKnowledge.findUnique({
      where: { domain: topDomain },
    });

    const existingDocIndex = (existing?.docIndex as DocRef[] | null) ?? [];
    const existingPlaybooks = (existing?.playbooks as Array<Record<string, unknown>> | null) ?? [];

    const mergedDocIndex = mergeDocRefs(existingDocIndex, allRefs);
    const mergedPlaybooks = mergePlaybooks(existingPlaybooks, newPlaybooks);

    await this.prisma.domainKnowledge.upsert({
      where: { domain: topDomain },
      create: {
        domain: topDomain,
        docIndex: mergedDocIndex as Prisma.InputJsonValue,
        entityGraph: {},
        playbooks: mergedPlaybooks as Prisma.InputJsonValue,
      },
      update: {
        docIndex: mergedDocIndex as Prisma.InputJsonValue,
        playbooks: mergedPlaybooks as Prisma.InputJsonValue,
      },
    });
  }
}

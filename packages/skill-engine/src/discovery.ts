import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

import type { LlmProvider, SkillDiscoveryRequest, SkillDiscoveryResult } from '@bclaw/shared';
import { CreateSkillSchema } from '@bclaw/shared';

import type { ParsedKnowledge } from './knowledge-parser.js';
import { parseMarkdown, parseOpenApi, parsePdf, parseUrl } from './knowledge-parser.js';

const DISCOVERY_SYSTEM_PROMPT = `You are a skill architect for an enterprise agentic platform.
Given a description of a capability and relevant knowledge sources (API docs, PDFs, etc.),
generate a structured skill definition.

A skill defines:
- name: short human-readable name
- domain: reverse-DNS style identifier (e.g. networking.extreme-xco)
- description: what this skill enables
- version: start at 1.0.0
- capabilities: array of short capability strings (e.g. "list-devices", "create-vlan")
- tools: array of LLM tool definitions the agent can call
- systemPrompt: a brief system prompt fragment injected when this skill is active

For tools, follow the JSON Schema convention for parameters.
Generate only what is described in the knowledge sources. Do not invent endpoints.`;

function buildModel(provider: LlmProvider) {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey: process.env['OPENAI_API_KEY'] })('gpt-4o');
    case 'anthropic':
      return createAnthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })('claude-3-5-sonnet-20241022');
    case 'azure-openai':
      return createOpenAI({
        apiKey: process.env['AZURE_OPENAI_API_KEY'],
        baseURL: process.env['AZURE_OPENAI_ENDPOINT'],
      })(process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4o');
    default:
      throw new Error(`Unknown LLM provider: ${String(provider)}`);
  }
}

export class SkillDiscoveryService {
  constructor(private readonly llmProvider: LlmProvider = 'openai') {}

  async discover(request: SkillDiscoveryRequest): Promise<SkillDiscoveryResult> {
    const parsed: ParsedKnowledge[] = [];

    for (const source of request.knowledgeSources ?? []) {
      switch (source.type) {
        case 'OPENAPI_JSON':
          parsed.push(parseOpenApi(JSON.parse(source.content) as Record<string, unknown>));
          break;
        case 'PDF':
          parsed.push(await parsePdf(Buffer.from(source.content, 'base64')));
          break;
        case 'MARKDOWN':
          parsed.push(parseMarkdown(source.content));
          break;
        case 'URL':
          parsed.push(await parseUrl(source.content));
          break;
      }
    }

    const knowledgeContext = parsed
      .map((p, i) => `--- Source ${i + 1} (${p.type}) ---\n${p.content}`)
      .join('\n\n');

    const userPrompt = [
      `Intent: ${request.intent}`,
      request.domain ? `Domain hint: ${request.domain}` : '',
      ``,
      knowledgeContext,
    ]
      .filter(Boolean)
      .join('\n');

    const model = buildModel(this.llmProvider);

    // Use Vercel AI SDK structured output (generateObject) to get a validated skill
    const { object } = await generateObject({
      model,
      system: DISCOVERY_SYSTEM_PROMPT,
      prompt: userPrompt,
      schema: z.object({
        skill: CreateSkillSchema,
        confidence: z.number().min(0).max(1),
      }),
    });

    return {
      skill: object.skill,
      confidence: object.confidence,
      sourcesUsed: parsed.map((p) => p.title ?? p.type),
    };
  }
}

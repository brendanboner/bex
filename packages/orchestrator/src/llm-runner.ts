import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import type { CoreMessage, CoreTool, LanguageModel } from 'ai';
import { generateText } from 'ai';
import { z } from 'zod';

import type { LlmProvider, SkillTool, ToolCallResult } from '@bclaw/shared';
import type { CredentialVaultService } from '@bclaw/credential-vault';

export function buildLlmModel(provider: LlmProvider, model: string): LanguageModel {
  const openaiKey = process.env['OPENAI_API_KEY'];
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  const azureKey = process.env['AZURE_OPENAI_API_KEY'];
  const azureResource = process.env['AZURE_OPENAI_RESOURCE_NAME'];

  switch (provider) {
    case 'openai':
      if (!openaiKey) throw new Error('OPENAI_API_KEY not set');
      return createOpenAI({ apiKey: openaiKey })(model);
    case 'anthropic':
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');
      return createAnthropic({ apiKey: anthropicKey })(model);
    case 'azure-openai':
      if (!azureKey || !azureResource) throw new Error('AZURE_OPENAI_API_KEY and AZURE_OPENAI_RESOURCE_NAME must be set');
      return createAzure({ apiKey: azureKey, resourceName: azureResource })(model);
    default:
      throw new Error(`Unknown LLM provider: ${String(provider)}`);
  }
}

/**
 * Converts a skill's tool definitions into Vercel AI SDK tool objects.
 */
export function buildTools(
  skillTools: SkillTool[],
  vault: CredentialVaultService,
  agentPermissions: string[],
  credentialId: string | undefined,
): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};

  for (const skillTool of skillTools) {
    const paramSchema = z.object(
      Object.fromEntries(
        Object.entries(
          (skillTool.parameters as { properties?: Record<string, { type: string; description?: string }> })
            .properties ?? {},
        ).map(([key, val]) => [
          key,
          val.type === 'string'
            ? z.string().describe(val.description ?? key)
            : val.type === 'number'
            ? z.number().describe(val.description ?? key)
            : val.type === 'boolean'
            ? z.boolean().describe(val.description ?? key)
            : z.unknown(),
        ]),
      ),
    );

    tools[skillTool.name] = {
      description: skillTool.description,
      parameters: paramSchema,
      execute: async (args: Record<string, unknown>): Promise<unknown> => {
        if (!skillTool.endpoint || !credentialId) {
          // This tool is specification-only — it has no configured endpoint.
          // It is available for the LLM to reference during planning but produces no side effects.
          return { result: 'schema-only', args, note: 'Tool has no endpoint configured; used for planning and analysis only.' };
        }

        const result = await vault.proxyRequest(
          {
            credentialId,
            method: 'POST',
            url: skillTool.endpoint,
            body: args,
            injection: { type: 'bearer' },
          },
          agentPermissions,
        );

        return result.body;
      },
    };
  }

  return tools;
}

export type RunLlmOptions = {
  model: LanguageModel;
  messages: CoreMessage[];
  tools?: Record<string, CoreTool>;
  systemPrompt?: string;
  maxSteps?: number;
};

export type RunLlmResult = {
  text: string;
  toolCalls: ToolCallResult[];
  usage: { promptTokens: number; completionTokens: number };
};

export async function runLlm(options: RunLlmOptions): Promise<RunLlmResult> {
  const { text, usage, steps } = await generateText({
    model: options.model,
    ...(options.systemPrompt !== undefined ? { system: options.systemPrompt } : {}),
    messages: options.messages,
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    maxSteps: options.maxSteps ?? 10,
  });

  const allToolCalls: ToolCallResult[] = [];
  for (const step of steps) {
    const stepToolCalls = step.toolCalls as Array<{ toolCallId: string; toolName: string }>;
    const stepToolResults = step.toolResults as Array<{ toolCallId: string; result: unknown }> | undefined;
    for (const tc of stepToolCalls) {
      const matchingResult = stepToolResults?.find((r) => r.toolCallId === tc.toolCallId);
      allToolCalls.push({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        result: matchingResult?.result ?? null,
      });
    }
  }

  return {
    text,
    toolCalls: allToolCalls,
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    },
  };
}

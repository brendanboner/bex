import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import type { CoreMessage, LanguageModel, Tool } from 'ai';
import { generateText } from 'ai';
import { z } from 'zod';

import type { LlmProvider, SkillTool, ToolCallResult } from '@bclaw/shared';
import { CredentialVaultService } from '@bclaw/credential-vault';

export function buildLlmModel(provider: LlmProvider, model: string): LanguageModel {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey: process.env['OPENAI_API_KEY'] })(model);
    case 'anthropic':
      return createAnthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })(model);
    case 'azure-openai':
      return createAzure({
        apiKey: process.env['AZURE_OPENAI_API_KEY'],
        resourceName: process.env['AZURE_OPENAI_RESOURCE_NAME'],
      })(model);
    default:
      throw new Error(`Unknown LLM provider: ${String(provider)}`);
  }
}

/**
 * Converts a skill's tool definitions into Vercel AI SDK tool objects.
 * Each tool that has an `endpoint` will call the credential-vault proxy;
 * tools without an endpoint return a placeholder asking the agent to describe
 * what it would do (useful for dry-run / planner mode).
 */
export function buildTools(
  skillTools: SkillTool[],
  vault: CredentialVaultService,
  agentPermissions: string[],
  credentialId: string | undefined,
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};

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
          return { result: 'dry-run', args };
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
  tools?: Record<string, Tool>;
  systemPrompt?: string;
  maxSteps?: number;
};

export type RunLlmResult = {
  text: string;
  toolCalls: ToolCallResult[];
  usage: { promptTokens: number; completionTokens: number };
};

export async function runLlm(options: RunLlmOptions): Promise<RunLlmResult> {
  const { text, toolCalls, usage } = await generateText({
    model: options.model,
    system: options.systemPrompt,
    messages: options.messages,
    tools: options.tools,
    maxSteps: options.maxSteps ?? 10,
  });

  const mappedToolCalls: ToolCallResult[] = toolCalls.map((tc) => ({
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    result: undefined,
    error: undefined,
  }));

  return {
    text,
    toolCalls: mappedToolCalls,
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    },
  };
}

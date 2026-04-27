import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import type { LanguageModel } from 'ai';

import type { LlmProvider } from '@bex/shared';

/**
 * Constructs the AI SDK model instance for the given LLM provider.
 * Shared by SkillDiscoveryService, SkillBuilderService, and SkillTestRunner.
 */
export function buildModel(provider: LlmProvider): LanguageModel {
  const openaiKey = process.env['OPENAI_API_KEY'];
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  const azureKey = process.env['AZURE_OPENAI_API_KEY'];
  const azureEndpoint = process.env['AZURE_OPENAI_ENDPOINT'];
  const azureApiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-08-01-preview';
  const azureDeployment = process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4o';

  switch (provider) {
    case 'openai':
      if (!openaiKey) throw new Error('OPENAI_API_KEY not set');
      return createOpenAI({ apiKey: openaiKey })('gpt-4o');
    case 'anthropic':
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');
      return createAnthropic({ apiKey: anthropicKey })('claude-3-5-sonnet-20241022');
    case 'azure-openai': {
      if (!azureKey) throw new Error('AZURE_OPENAI_API_KEY not set');
      if (!azureEndpoint) throw new Error('Azure endpoint not configured — set AZURE_OPENAI_ENDPOINT');
      const azureBaseURL = `${azureEndpoint.replace(/\/$/, '')}/openai/deployments`;
      const azureFetch: typeof fetch = (url, init) => {
        const u = new URL(url.toString());
        u.searchParams.set('api-version', azureApiVersion);
        return fetch(u.toString(), init);
      };
      return createAzure({ apiKey: azureKey, baseURL: azureBaseURL, fetch: azureFetch })(azureDeployment);
    }
    default:
      throw new Error(`Unknown LLM provider: ${String(provider)}`);
  }
}

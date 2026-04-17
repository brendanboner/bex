import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import type { LanguageModel } from 'ai';

export function buildModel(
  provider: string = process.env['LLM_PROVIDER'] ?? 'openai',
  model: string = process.env['LLM_MODEL'] ?? 'gpt-4o',
): LanguageModel {
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
      if (!azureKey || !azureResource)
        throw new Error('AZURE_OPENAI_API_KEY and AZURE_OPENAI_RESOURCE_NAME must be set');
      return createAzure({ apiKey: azureKey, resourceName: azureResource })(model);
    default:
      throw new Error(`Unknown LLM provider: ${String(provider)}`);
  }
}

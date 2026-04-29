import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import type { LanguageModel } from 'ai';

export function buildModel(
  provider: string = process.env['LLM_PROVIDER'] ?? 'openai',
  model: string = process.env['LLM_MODEL'] ?? 'gpt-4o',
  baseUrl?: string,
): LanguageModel {
  const openaiKey = process.env['OPENAI_API_KEY'];
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  const azureKey = process.env['AZURE_OPENAI_API_KEY'];
  const azureEndpoint = baseUrl ?? process.env['AZURE_OPENAI_ENDPOINT'];
  const azureApiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-08-01-preview';

  switch (provider) {
    case 'openai':
      if (!openaiKey) throw new Error('OPENAI_API_KEY not set');
      return createOpenAI({ apiKey: openaiKey })(model);
    case 'anthropic':
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');
      return createAnthropic({ apiKey: anthropicKey })(model);
    case 'azure':
    case 'azure-openai': {
      if (!azureKey) throw new Error('AZURE_OPENAI_API_KEY not set');
      if (!azureEndpoint) throw new Error('Azure endpoint not configured — set AZURE_OPENAI_ENDPOINT');
      const azureBaseURL = `${azureEndpoint.replace(/\/$/, '')}/openai/deployments`;
      const azureFetch: typeof fetch = (url, init) => {
        const u = new URL(url.toString());
        u.searchParams.set('api-version', azureApiVersion);
        return fetch(u.toString(), init);
      };
      return createAzure({ apiKey: azureKey, baseURL: azureBaseURL, fetch: azureFetch })(model);
    }
    case 'ollama': {
      // Ollama exposes an OpenAI-compatible REST API at /v1
      const ollamaBase = baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
      const base = ollamaBase.replace(/\/$/, '');
      return createOpenAI({
        baseURL: `${base}/v1`,
        apiKey: 'ollama', // Ollama doesn't require an API key but the SDK needs a non-empty value
      })(model);
    }
    default:
      throw new Error(`Unknown LLM provider: ${String(provider)}`);
  }
}

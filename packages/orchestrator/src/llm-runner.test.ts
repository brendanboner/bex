import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock external dependencies before importing
vi.mock('@bex/credential-vault', () => ({
  CredentialVaultService: class {
    proxyRequest() { return Promise.resolve({ status: 200, headers: {}, body: { result: 'ok' } }); }
  },
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => () => ({ modelId: 'gpt-4o' }),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => () => ({ modelId: 'claude-3-5-sonnet' }),
}));

vi.mock('@ai-sdk/azure', () => ({
  createAzure: () => () => ({ modelId: 'azure-gpt4o' }),
}));

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: 'Hello from the LLM',
    toolCalls: [],
    steps: [],
    usage: { promptTokens: 10, completionTokens: 20 },
  }),
}));

import { buildLlmModel, buildTools, runLlm } from '../src/llm-runner.js';
import { CredentialVaultService } from '@bex/credential-vault';
import { PrismaClient } from '@prisma/client';

const mockVault = new CredentialVaultService({} as PrismaClient);

describe('llm-runner', () => {
  describe('buildLlmModel', () => {
    beforeEach(() => {
      process.env['OPENAI_API_KEY'] = 'test-key';
      process.env['ANTHROPIC_API_KEY'] = 'test-key';
      process.env['AZURE_OPENAI_API_KEY'] = 'test-key';
      process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'test-resource';
    });

    it('builds an openai model', () => {
      const model = buildLlmModel('openai', 'gpt-4o');
      expect(model).toBeDefined();
    });

    it('builds an anthropic model', () => {
      const model = buildLlmModel('anthropic', 'claude-3-5-sonnet-20241022');
      expect(model).toBeDefined();
    });

    it('throws for unknown provider', () => {
      // @ts-expect-error testing invalid provider
      expect(() => buildLlmModel('unknown', 'model')).toThrow('Unknown LLM provider');
    });
  });

  describe('buildTools', () => {
    it('returns an empty object for empty skillTools', () => {
      const tools = buildTools([], mockVault, [], undefined);
      expect(tools).toEqual({});
    });

    it('creates a tool for each skill tool definition', () => {
      const skillTools = [
        {
          name: 'list_devices',
          description: 'List all devices',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max results' },
            },
          },
        },
      ];
      const tools = buildTools(skillTools, mockVault, ['read:network'], undefined);
      expect(tools['list_devices']).toBeDefined();
      expect(tools['list_devices']).toBeDefined();
    });

    it('returns dry-run result when no credential or endpoint is set', async () => {
      const skillTools = [
        {
          name: 'check_health',
          description: 'Check device health',
          parameters: { type: 'object', properties: {} },
        },
      ];
      const tools = buildTools(skillTools, mockVault, [], undefined);
      const execute = tools['check_health']?.execute as (args: Record<string, unknown>) => Promise<unknown>;
      const result = await execute({});
      expect(result).toMatchObject({ result: 'schema-only' });
    });
  });

  describe('runLlm', () => {
    it('calls generateText and maps the result', async () => {
      const model = buildLlmModel('openai', 'gpt-4o');
      const result = await runLlm({
        model,
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(result.text).toBe('Hello from the LLM');
      expect(result.toolCalls).toEqual([]);
      expect(result.usage.promptTokens).toBe(10);
    });
  });
});

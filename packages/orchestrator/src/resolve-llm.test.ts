import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { CredentialVaultService } from '@bex/credential-vault';

import { resolveSystemLlm } from './resolve-llm.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma(findFirstResult: unknown) {
  return {
    lLMConfig: {
      findFirst: vi.fn().mockResolvedValue(findFirstResult),
    },
  } as unknown as PrismaClient;
}

function makeVault(apiKey: string) {
  return {
    resolve: vi.fn().mockResolvedValue({ apiKey }),
  } as unknown as CredentialVaultService;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolveSystemLlm', () => {
  it('returns DB config when a default LLMConfig exists', async () => {
    const prisma = makePrisma({
      provider: 'azure-openai',
      model: 'gpt-4o',
      credentialId: 'cred-1',
      baseUrl: 'https://myresource.openai.azure.com',
      apiVersion: '2024-08-01-preview',
    });
    const vault = makeVault('vault-key-123');

    const result = await resolveSystemLlm(prisma, vault);

    expect(result.provider).toBe('azure-openai');
    expect(result.model).toBe('gpt-4o');
    expect(result.apiKey).toBe('vault-key-123');
    expect(result.baseUrl).toBe('https://myresource.openai.azure.com');
    expect(result.apiVersion).toBe('2024-08-01-preview');
  });

  it('returns env-var fallback when no default LLMConfig in DB', async () => {
    process.env['LLM_PROVIDER'] = 'anthropic';
    process.env['LLM_MODEL'] = 'claude-3-5-sonnet-20241022';

    const result = await resolveSystemLlm(makePrisma(null));

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.apiKey).toBeUndefined();
  });

  it('returns env-var fallback when DB lookup throws', async () => {
    process.env['LLM_PROVIDER'] = 'openai';
    process.env['LLM_MODEL'] = 'gpt-4o';
    const prisma = {
      lLMConfig: { findFirst: vi.fn().mockRejectedValue(new Error('DB connection failed')) },
    } as unknown as PrismaClient;

    const result = await resolveSystemLlm(prisma);

    expect(result.provider).toBe('openai');
    expect(result.apiKey).toBeUndefined();
  });

  it('resolves without a vault when credentialId is absent', async () => {
    const prisma = makePrisma({
      provider: 'openai',
      model: 'gpt-4o',
      credentialId: null,
      baseUrl: null,
      apiVersion: null,
    });

    const result = await resolveSystemLlm(prisma);

    expect(result.provider).toBe('openai');
    expect(result.apiKey).toBeUndefined();
  });
});

import type { PrismaClient } from '@prisma/client';
import type { CredentialVaultService } from '@bex/credential-vault';
import type { LlmProvider } from '@bex/shared';

export interface ResolvedLlm {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
}

/**
 * Resolves the system LLM configuration from the database (default LLMConfig).
 * Falls back to environment variables if no default config is found.
 * Use this at the route/handler level and pass the result into services.
 */
export async function resolveSystemLlm(
  prisma: PrismaClient,
  vault?: CredentialVaultService,
): Promise<ResolvedLlm> {
  try {
    const defaultConfig = await prisma.lLMConfig.findFirst({
      where: { isDefault: true },
      include: { credential: { select: { id: true } } },
    });

    if (defaultConfig) {
      let apiKey: string | undefined;
      if (defaultConfig.credentialId && vault) {
        const cred = await vault.resolve(defaultConfig.credentialId, []);
        apiKey = (cred as { apiKey?: string }).apiKey;
      }
      return {
        provider: defaultConfig.provider as LlmProvider,
        model: defaultConfig.model,
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(defaultConfig.baseUrl ? { baseUrl: defaultConfig.baseUrl } : {}),
        ...(defaultConfig.apiVersion ? { apiVersion: defaultConfig.apiVersion } : {}),
      };
    }
  } catch {
    // Fall through to env-var fallback
  }

  return {
    provider: (process.env['LLM_PROVIDER'] as LlmProvider) ?? 'openai',
    model: process.env['LLM_MODEL'] ?? 'gpt-4o',
  };
}

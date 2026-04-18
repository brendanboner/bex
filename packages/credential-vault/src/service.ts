import { PrismaClient } from '@prisma/client';

import type { CreateCredentialInput, CredentialValues, CredentialType, ProxiedRequestConfig, ProxiedRequestResult } from '@bclaw/shared';
import { ErrorCodes } from '@bclaw/shared';

import { decrypt, encrypt } from './crypto.js';

/** Auto-infer HTTP injection strategy from the credential type. */
function inferInjection(
  credentialType: CredentialType,
): { type: 'bearer' } | { type: 'basic' } | { type: 'header'; key: string } {
  switch (credentialType) {
    case 'USERNAME_PASSWORD':
    case 'BASIC_AUTH':
      return { type: 'basic' };
    case 'OAUTH2_CLIENT':
    case 'API_TOKEN':
    default:
      return { type: 'bearer' };
  }
}

export class CredentialVaultService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateCredentialInput,
    userId?: string,
  ): Promise<{ id: string; name: string; credentialType: string }> {
    const blob = encrypt(input.value);

    const credential = await this.prisma.credential.create({
      data: {
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        scope: input.scope,
        credentialType: input.credentialType ?? 'API_TOKEN',
        encryptedValue: blob.encryptedValue,
        iv: blob.iv,
        authTag: blob.authTag,
        allowedAgentPermissions: input.allowedAgentPermissions,
        userId: input.scope === 'USER' && userId != null ? userId : null,
      },
      select: { id: true, name: true, credentialType: true },
    });

    return credential;
  }

  async resolve(credentialId: string, agentPermissions: string[]): Promise<CredentialValues & { _type: string }> {
    // Try by ID first; fall back to name lookup so callers that store a
    // credential name (rather than its cuid) still work.
    let credential = await this.prisma.credential.findUnique({ where: { id: credentialId } });
    if (!credential) {
      credential = await this.prisma.credential.findFirst({
        where: { name: { equals: credentialId, mode: 'insensitive' } },
        orderBy: [{ scope: 'desc' }, { createdAt: 'desc' }],
      });
    }

    if (!credential) {
      throw Object.assign(new Error('Credential not found'), { code: ErrorCodes.CREDENTIAL_NOT_FOUND });
    }

    // Check that the requesting agent has at least one matching permission
    const allowed =
      credential.allowedAgentPermissions.length === 0 ||
      agentPermissions.some((p) => credential.allowedAgentPermissions.includes(p));

    if (!allowed) {
      throw Object.assign(new Error('Agent does not have permission to use this credential'), {
        code: ErrorCodes.FORBIDDEN,
      });
    }

    const values = decrypt({
      encryptedValue: credential.encryptedValue,
      iv: credential.iv,
      authTag: credential.authTag,
    });

    // Attach the type as a hidden metadata field so callers can inspect it
    return { ...values, _type: credential.credentialType };
  }

  /**
   * Executes an outbound HTTP request, injecting the credential value without
   * exposing it to the caller. Supports `injection: { type: 'auto' }` to
   * auto-select the injection strategy based on credentialType.
   */
  async proxyRequest(
    config: ProxiedRequestConfig,
    agentPermissions: string[],
  ): Promise<ProxiedRequestResult> {
    const values = await this.resolve(config.credentialId, agentPermissions);

    const headers: Record<string, string> = { ...config.headers };

    // Resolve injection: 'auto' defers to the credential's own type
    const injection =
      config.injection.type === 'auto'
        ? inferInjection(values['_type'] as CredentialType)
        : config.injection;

    switch (injection.type) {
      case 'bearer': {
        const headerName = values['headerName'] ?? 'Authorization';
        headers[headerName] = `Bearer ${values['token'] ?? values['api_key'] ?? ''}`;
        break;
      }
      case 'header':
        headers[injection.key] = values[injection.key] ?? values['token'] ?? values['value'] ?? '';
        break;
      case 'basic': {
        const encoded = Buffer.from(
          `${values['username'] ?? ''}:${values['password'] ?? ''}`,
        ).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
        break;
      }
      case 'query':
        // Query injection handled in URL construction below
        break;
    }

    let url = config.url;
    if (injection.type === 'query') {
      const sep = url.includes('?') ? '&' : '?';
      const paramKey = (injection as { type: 'query'; key: string }).key;
      url = `${url}${sep}${paramKey}=${encodeURIComponent(values[paramKey] ?? values['value'] ?? '')}`;
    }

    const { fetch } = await import('undici');
    const response = await fetch(url, {
      method: config.method,
      headers,
      ...(config.body !== undefined ? { body: JSON.stringify(config.body) } : {}),
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const body: unknown = await (async () => {
      const ct = response.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        return response.json();
      }
      return response.text();
    })();

    return {
      status: response.status,
      headers: responseHeaders,
      body,
    };
  }

  async delete(credentialId: string): Promise<void> {
    await this.prisma.credential.delete({ where: { id: credentialId } });
  }

  async list(
    scope?: 'USER' | 'SYSTEM',
    userId?: string,
  ): Promise<Array<{ id: string; name: string; scope: string; credentialType: string; description: string | null }>> {
    return this.prisma.credential.findMany({
      where: scope
        ? { scope }
        // No scope filter: return USER credentials owned by this user + all SYSTEM credentials
        : { OR: [{ scope: 'SYSTEM' }, ...(userId ? [{ scope: 'USER' as const, userId }] : [])] },
      select: { id: true, name: true, scope: true, credentialType: true, description: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}

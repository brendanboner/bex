import { PrismaClient } from '@prisma/client';

import type { CreateCredentialInput, CredentialValues, ProxiedRequestConfig, ProxiedRequestResult } from '@bclaw/shared';
import { ErrorCodes } from '@bclaw/shared';

import { decrypt, encrypt } from './crypto.js';

export class CredentialVaultService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateCredentialInput,
    userId?: string,
  ): Promise<{ id: string; name: string }> {
    const blob = encrypt(input.value);

    const credential = await this.prisma.credential.create({
      data: {
        name: input.name,
        description: input.description,
        scope: input.scope,
        encryptedValue: blob.encryptedValue,
        iv: blob.iv,
        authTag: blob.authTag,
        allowedAgentPermissions: input.allowedAgentPermissions,
        userId: input.scope === 'USER' ? userId : null,
      },
      select: { id: true, name: true },
    });

    return credential;
  }

  async resolve(credentialId: string, agentPermissions: string[]): Promise<CredentialValues> {
    const credential = await this.prisma.credential.findUnique({
      where: { id: credentialId },
    });

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

    return decrypt({
      encryptedValue: credential.encryptedValue,
      iv: credential.iv,
      authTag: credential.authTag,
    });
  }

  /**
   * Executes an outbound HTTP request, injecting the credential value without
   * exposing it to the caller. Returns the response without the credential.
   */
  async proxyRequest(
    config: ProxiedRequestConfig,
    agentPermissions: string[],
  ): Promise<ProxiedRequestResult> {
    const values = await this.resolve(config.credentialId, agentPermissions);

    const headers: Record<string, string> = { ...config.headers };

    switch (config.injection.type) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${values['token'] ?? values['api_key'] ?? ''}`;
        break;
      case 'header':
        headers[config.injection.key] = values[config.injection.key] ?? values['value'] ?? '';
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
    if (config.injection.type === 'query') {
      const sep = url.includes('?') ? '&' : '?';
      const paramKey = config.injection.key;
      url = `${url}${sep}${paramKey}=${encodeURIComponent(values[paramKey] ?? values['value'] ?? '')}`;
    }

    const { fetch } = await import('undici');
    const response = await fetch(url, {
      method: config.method,
      headers,
      body:
        config.body !== undefined
          ? JSON.stringify(config.body)
          : undefined,
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

  async list(scope?: 'USER' | 'SYSTEM', userId?: string): Promise<Array<{ id: string; name: string; scope: string; description: string | null }>> {
    return this.prisma.credential.findMany({
      where: {
        ...(scope ? { scope } : {}),
        ...(userId ? { userId } : {}),
      },
      select: { id: true, name: true, scope: true, description: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
